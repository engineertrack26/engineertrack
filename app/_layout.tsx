import '../global.css';
import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';

SplashScreen.preventAutoHideAsync();

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated and will be removed in a future release',
]);

export default function RootLayout() {
  const { setUser, setSession, setLoading, reset, isAuthenticated, isLoading } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);

  // Listen for auth state changes
  useEffect(() => {
    async function initAuth() {
      try {
        const session = await authService.getSession();
        if (session?.user) {
          const profile = await authService.getProfile(session.user.id);
          setSession(session);
          setUser(profile);
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
      async (event: string, session: unknown) => {
        if (event === 'SIGNED_OUT' || !session) {
          reset();
          setLoading(false);
        }
      },
    );

    return () => {
      subscription.unsubscribe();
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
