import '../global.css';
import { useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import {
  registerForPushNotifications,
  saveTokenToProfile,
  removeToken,
} from '@/services/pushNotifications';

// Show notifications when app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

SplashScreen.preventAutoHideAsync();

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated and will be removed in a future release',
]);

export default function RootLayout() {
  const { setUser, setSession, setLoading, reset, isAuthenticated } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription>(null);
  const responseListener = useRef<Notifications.EventSubscription>(null);

  // Listen for auth state changes
  useEffect(() => {
    async function initAuth() {
      try {
        const session = await authService.getSession();
        if (session?.user) {
          const profile = await authService.getProfileWithRetry(session.user.id);
          setSession(session);
          setUser(profile);

          // Register for push notifications
          try {
            const pushToken = await registerForPushNotifications();
            if (pushToken) {
              await saveTokenToProfile(session.user.id, pushToken);
            }
          } catch (err) {
            console.log('Push notification setup failed:', err);
          }
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
          reset();
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
          } catch (err) {
            console.log('Auth state profile sync failed:', err);
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
    // Notification received while app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('Notification received:', notification.request.content.title);
      },
    );

    // User tapped on a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.type) {
          // Navigate based on notification type
          const type = data.type as string;
          if (type === 'log_approved' || type === 'log_revision_requested' || type === 'log_sent_back') {
            router.push('/(student)/log-history');
          } else if (type === 'new_feedback') {
            router.push('/(student)/log-history');
          } else if (type === 'badge_earned' || type === 'level_up') {
            router.push('/(student)/achievements');
          } else if (type === 'poll_available') {
            router.push('/(student)/polls');
          }
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

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
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
