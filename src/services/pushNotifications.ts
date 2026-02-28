import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from './supabase';

/**
 * Set up Android notification channel (required for Android 8+).
 */
async function setupAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1a73e8',
    });
  }
}

/**
 * Request permissions and get the Expo push token.
 * Returns null if running in Expo Go, on simulator, or permissions denied.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications are not supported in Expo Go (SDK 53+)
  if (Constants.appOwnership === 'expo') {
    console.log('Push notifications are not supported in Expo Go. Use a development build.');
    return null;
  }

  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  await setupAndroidChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission denied');
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return tokenData.data;
}

/**
 * Save the Expo push token to the user's profile.
 */
export async function saveTokenToProfile(
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ expo_push_token: token })
    .eq('id', userId);

  if (error) {
    console.error('Failed to save push token:', error.message);
  }
}

/**
 * Clear the push token from the user's profile (on logout).
 */
export async function removeToken(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ expo_push_token: null })
    .eq('id', userId);

  if (error) {
    console.error('Failed to remove push token:', error.message);
  }
}

/**
 * Send a push notification to a single user via Expo Push API.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', userId)
    .single();

  if (error || !profile?.expo_push_token) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      to: profile.expo_push_token,
      title,
      body,
      data: data || {},
      sound: 'default',
    }),
  });
}

/**
 * Send push notifications to multiple users.
 */
export async function sendPushToMultiple(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (userIds.length === 0) return;

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .in('id', userIds)
    .not('expo_push_token', 'is', null);

  if (error || !profiles?.length) return;

  const tokens = profiles
    .map((p) => (p as Record<string, unknown>).expo_push_token as string)
    .filter(Boolean);

  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    data: data || {},
    sound: 'default' as const,
  }));

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(messages),
  });
}

export const pushNotificationService = {
  registerForPushNotifications,
  saveTokenToProfile,
  removeToken,
  sendPushNotification,
  sendPushToMultiple,
};
