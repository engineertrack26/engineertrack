import '../global.css';
import { useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import type * as Notifications from 'expo-notifications';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import i18n from '@/i18n';
import type { User } from '@/types/user';
import { useAuthStore } from '@/store/authStore';
import { routeForNotification } from '@/utils/notificationRoutes';
import { useLogStore } from '@/store/logStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useGroupStore } from '@/store/groupStore';
import { authService } from '@/services/auth';
import { getNotifications } from '@/services/expoNotifications';
import {
  registerForPushNotifications,
  saveTokenToProfile,
  removeToken,
} from '@/services/pushNotifications';
import { ErrorFallback } from '@/components/common/ErrorFallback';

// Show notifications when app is in the foreground.
//
// Guarded because this runs at MODULE scope: expo-notifications throws from
// its own import in Expo Go on Android since SDK 55, so a bare call here took
// the whole app down on launch before any component rendered. getNotifications
// returns null there, and every push feature is unavailable in Expo Go anyway.
getNotifications()?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

SplashScreen.preventAutoHideAsync();

// Crash reporting — no-op unless a DSN is configured (EXPO_PUBLIC_SENTRY_DSN)
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (sentryDsn) {
  try {
    Sentry.init({ dsn: sentryDsn, enabled: !__DEV__ });
  } catch (e) {
    console.warn('Sentry init failed:', e);
  }
}

// Global error boundary — catches render errors anywhere in the route tree
export function ErrorBoundary(props: ErrorBoundaryProps) {
  useEffect(() => {
    if (sentryDsn) {
      Sentry.captureException(props.error);
    }
  }, [props.error]);
  return <ErrorFallback {...props} />;
}

// Apply the user's saved language preference (falls back to device language
// from i18n init when the profile has none)
function applyUserLanguage(profile: User | null) {
  if (profile?.language && profile.language !== i18n.language) {
    i18n.changeLanguage(profile.language).catch(() => {});
  }
}

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated and will be removed in a future release',
]);

// Routes inside (auth) that an ALREADY authenticated user is legitimately on:
// the consent gate that app/index.tsx sends them to, and the privacy policy,
// which every role's profile links to. Without this exemption the bounce-back
// below fights the consent gate in an infinite redirect loop.
const AUTHENTICATED_AUTH_ROUTES = ['consent', 'privacy-policy'];

export default function RootLayout() {
  const { setUser, setSession, setLoading, reset, isAuthenticated } = useAuthStore();
  const resetLogStore = useLogStore((s) => s.reset);
  const resetGamificationStore = useGamificationStore((s) => s.reset);
  const resetNotificationStore = useNotificationStore((s) => s.reset);
  const resetGroupStore = useGroupStore((s) => s.reset);
  const segments = useSegments();
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription>(null);
  const responseListener = useRef<Notifications.EventSubscription>(null);

  // The user id the push token was last registered for. Registration must
  // run once per sign-in, not once per app launch: SIGNED_OUT clears the
  // token from the profile, so a user who signs out and back in on the same
  // device has no token until they restart the app if only initAuth does it.
  // Keyed by uid rather than a boolean so TOKEN_REFRESHED (hourly) does not
  // re-prompt or re-save, but a different account signing in does register.
  const pushRegisteredFor = useRef<string | null>(null);

  async function registerPushFor(uid: string) {
    if (pushRegisteredFor.current === uid) return;
    pushRegisteredFor.current = uid;
    try {
      const pushToken = await registerForPushNotifications();
      if (pushToken) {
        await saveTokenToProfile(uid, pushToken);
      }
    } catch (err) {
      // Let the next sign-in try again rather than remembering a failure.
      pushRegisteredFor.current = null;
      console.warn('Push notification setup failed:', err);
    }
  }

  // Listen for auth state changes
  useEffect(() => {
    async function initAuth() {
      try {
        const session = await authService.getSession();
        if (session?.user) {
          const profile = await authService.getProfileWithRetry(session.user.id);
          setSession(session);
          setUser(profile);
          applyUserLanguage(profile);
          await registerPushFor(session.user.id);
        }
      } catch {
        // No active session
      } finally {
        setLoading(false);
        setAppReady(true);
      }
    }

    initAuth();

    const { data: { subscription } } = authService.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          // Clear push token before resetting user state
          const currentUser = useAuthStore.getState().user;
          if (currentUser?.id) {
            removeToken(currentUser.id).catch(() => {});
          }
          pushRegisteredFor.current = null;
          // Reset all stores so no previous user's data leaks to next user
          reset();
          resetLogStore();
          resetGamificationStore();
          resetNotificationStore();
          resetGroupStore();
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          try {
            const uid = session?.user?.id;
            if (!uid) return;
            const profile = await authService.getProfileWithRetry(uid);
            setSession(session);
            setUser(profile);
            applyUserLanguage(profile);
            // A sign-in that happened after launch -- the app opened with no
            // session and the user logged in -- reaches here, not initAuth.
            if (event === 'SIGNED_IN') {
              await registerPushFor(uid);
            }
          } catch (err) {
            console.warn('Auth state profile sync failed:', err);
          } finally {
            setLoading(false);
          }
        }
      },
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Set up notification listeners
  useEffect(() => {
    // Absent in Expo Go, where the module cannot be loaded at all. The cleanup
    // below is unconditional and safe: both refs stay null.
    const Notifications = getNotifications();
    if (!Notifications) return;

    // Notification received while app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('Notification received:', notification.request.content.title);
      },
    );

    // User tapped on a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        if (!data?.type) return;
        // The destination depends on who is signed in as much as on the
        // type: task_submitted goes to the mentor's queue, task_approved to
        // the student's task. Read the role at tap time, not at mount --
        // this listener outlives sign-in.
        const role = useAuthStore.getState().user?.role;
        const route = routeForNotification(data.type as string, data, role);
        if (route) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          router.push(route as any);
        }
      },
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  // Hide splash screen when ready
  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync();
    }
  }, [appReady]);

  // Protected routing
  useEffect(() => {
    if (!appReady) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isSharedAuthRoute = AUTHENTICATED_AUTH_ROUTES.includes((segments as string[])[1]);

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup && !isSharedAuthRoute) {
      router.replace('/');
    }
  }, [isAuthenticated, appReady, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
