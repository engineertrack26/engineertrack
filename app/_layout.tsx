import '../global.css';
import * as Linking from 'expo-linking';
import { captureRecoveryLink } from '@/utils/recoveryLinkInbox';
import { useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import type * as Notifications from 'expo-notifications';
import { ActivityIndicator, LogBox, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFonts } from 'expo-font';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_400Regular_Italic,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from '@expo-google-fonts/ibm-plex-sans';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import i18n from '@/i18n';
import type { User } from '@/types/user';
import { useAuthStore } from '@/store/authStore';
import { isConsentCurrent } from '@/utils/consent';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import { routeForNotification } from '@/utils/notificationRoutes';
import { useLogStore } from '@/store/logStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useGroupStore } from '@/store/groupStore';
import { useMessageStore } from '@/store/messageStore';
import { authService } from '@/services/auth';
import { getNotifications } from '@/services/expoNotifications';
import {
  registerForPushNotifications,
  saveTokenToProfile,
  removeToken,
} from '@/services/pushNotifications';
import { ErrorFallback } from '@/components/common/ErrorFallback';
import { deferAuthWork, withAuthTimeout } from '@/utils/authStartup';
import { colors } from '@/theme';

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

void SplashScreen.preventAutoHideAsync().catch(() => {});

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

// Route groups that belong to exactly one role. A signed-in user found in a
// group that is not theirs is sent back to "/" to be re-routed.
const ROLE_GROUPS = ['(student)', '(mentor)', '(advisor)'];

// Routes inside (auth) that an ALREADY authenticated user is legitimately on:
// the consent gate that app/index.tsx sends them to, and the privacy policy,
// which every role's profile links to. Without this exemption the bounce-back
// below fights the consent gate in an infinite redirect loop.
const AUTHENTICATED_AUTH_ROUTES = ['consent', 'privacy-policy', 'reset-password', 'forgot-password', 'language-select'];

export default function RootLayout() {
  const { t } = useTranslation();
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_400Regular_Italic,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  });
  const { setUser, setSession, setLoading, reset, isAuthenticated, user } = useAuthStore();
  const resetLogStore = useLogStore((s) => s.reset);
  const resetGamificationStore = useGamificationStore((s) => s.reset);
  const resetNotificationStore = useNotificationStore((s) => s.reset);
  const resetGroupStore = useGroupStore((s) => s.reset);
  const resetMessageStore = useMessageStore((s) => s.reset);
  const segments = useSegments();
  const isRecoveryRoute = segments[0] === '(auth)' && (segments as string[])[1] === 'reset-password';
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const [startupFailed, setStartupFailed] = useState(false);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const notificationListener = useRef<Notifications.EventSubscription>(null);
  const responseListener = useRef<Notifications.EventSubscription>(null);
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => captureRecoveryLink(url));
    return () => subscription.remove();
  }, []);

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

  // Never await Supabase work from its auth event callback: the emitter holds
  // the session lock until that callback returns.
  useEffect(() => {
    let active = true;
    let revision = 0;
    const cancellations = new Set<() => void>();
    const current = (request: number) => active && request === revision;
    const schedule = (work: () => void) => {
      const cancel = deferAuthWork(() => {
        cancellations.delete(cancel);
        if (active) work();
      });
      cancellations.add(cancel);
    };
    function clearStores() {
      pushRegisteredFor.current = null;
      reset();
      resetLogStore();
      resetGamificationStore();
      resetNotificationStore();
      resetGroupStore();
      resetMessageStore();
    }
    function ready(request: number) {
      if (!current(request)) return;
      setStartupFailed(false);
      setLoading(false);
      setAppReady(true);
    }
    function failed(request: number) {
      if (!current(request)) return;
      setStartupFailed(true);
      setAppReady(false);
      // Keep index.tsx from redirecting beneath the startup error screen.
      setLoading(true);
    }
    async function syncSession(
      session: Awaited<ReturnType<typeof authService.getSession>>, request: number,
    ) {
      try {
        if (!session?.user) {
          if (current(request)) { clearStores(); ready(request); }
          return;
        }
        const profile = await withAuthTimeout(authService.getProfileWithRetry(session.user.id));
        if (!current(request)) return;
        setSession(session);
        setUser(profile);
        applyUserLanguage(profile);
        ready(request);
        // Push registration is optional; it must never delay opening the app.
        void registerPushFor(session.user.id);
      } catch {
        failed(request);
      }
    }
    async function initAuth() {
      const request = ++revision;
      setAppReady(false);
      setStartupFailed(false);
      setLoading(true);
      try {
        // One deadline covers both session restore and profile lookup.
        const result = await withAuthTimeout((async () => {
          const session = await authService.getSession();
          const profile = session?.user
            ? await authService.getProfileWithRetry(session.user.id) : null;
          return { session, profile };
        })());
        if (!current(request)) return;
        if (result.session?.user && result.profile) {
          setSession(result.session);
          setUser(result.profile);
          applyUserLanguage(result.profile);
          ready(request);
          void registerPushFor(result.session.user.id);
        } else {
          clearStores();
          ready(request);
        }
      } catch {
        failed(request);
      }
    }

    const { data: { subscription } } = authService.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return; // handled by initAuth
      if (event === 'SIGNED_OUT') {
        const request = ++revision;
        const uid = useAuthStore.getState().user?.id;
        clearStores();
        ready(request);
        if (uid) schedule(() => { void removeToken(uid).catch(() => {}); });
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        const request = ++revision;
        schedule(() => { void syncSession(session, request); });
      }
    });
    void initAuth();

    return () => {
      active = false;
      revision++;
      subscription.unsubscribe();
      cancellations.forEach(cancel => cancel());
    };
  }, [startupAttempt]);

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

  // Network/auth work gets a visible loading/error UI, never an endless logo.
  // Held until the app's font is loaded too, so nothing renders in the
  // system fallback face and then swaps to IBM Plex Sans a frame later.
  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    void SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  // Protected routing
  useEffect(() => {
    if (!appReady) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isSharedAuthRoute = AUTHENTICATED_AUTH_ROUTES.includes((segments as string[])[1]);

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }
    if (isAuthenticated && inAuthGroup && !isSharedAuthRoute) {
      router.replace('/');
      return;
    }

    // The two checks index.tsx makes are repeated here because index.tsx is
    // only visited on the way in from "/". A push tap, a deep link or a
    // restored navigation state lands directly on a role route and never
    // passes through it -- so without this a mentor could sit on a student
    // tab, and a user whose consent lapsed could keep using the app until
    // they happened to hit "/". RLS still holds on the server; this is the
    // client half of the same rule.
    if (isAuthenticated && !inAuthGroup && user) {
      if (!isConsentCurrent(user.consentVersion, PRIVACY_POLICY_VERSION)) {
        router.replace('/(auth)/consent');
        return;
      }
      const group = segments[0] as string | undefined;
      const ownGroup = `(${user.role})`;
      if (group && ROLE_GROUPS.includes(group) && group !== ownGroup) {
        router.replace('/');
      }
    }
  }, [isAuthenticated, appReady, segments, user]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Slot />
        {!appReady && !isRecoveryRoute && <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.background,
          alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          {startupFailed ? <>
            <Text accessibilityRole="alert" style={{ fontSize: 18, color: colors.text, textAlign: 'center' }}>
              {t('common.loadFailed')}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setStartupAttempt(value => value + 1)}
              style={{ minHeight: 48, padding: 16, borderRadius: 12, backgroundColor: colors.primaryDark }}>
              <Text style={{ color: '#fff', fontSize: 16 }}>{t('common.retry')}</Text>
            </Pressable>
          </> : <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, color: colors.textSecondary }}>{t('common.loading')}</Text>
          </>}
        </View>}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
