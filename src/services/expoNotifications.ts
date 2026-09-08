import Constants from 'expo-constants';

type NotificationsModule = typeof import('expo-notifications');

/** Whether `expo-notifications` can be loaded at all.
 *
 *  Remote push was removed from Expo Go in SDK 53. Until SDK 55 the module
 *  merely warned; from SDK 55 it THROWS, and it throws from the import itself
 *  -- `DevicePushTokenAutoRegistration.fx.js` runs a side effect the moment the
 *  package is required. A static `import * as Notifications from
 *  'expo-notifications'` anywhere in the tree therefore crashes the whole app
 *  on launch in Expo Go on Android, before any of our own guards can run.
 *
 *  Every push feature is unavailable there regardless, so the module is loaded
 *  lazily and only where it can actually work. In a development build or a
 *  release build this is a normal require on first use. */
export const pushAvailable = Constants.appOwnership !== 'expo';

let cached: NotificationsModule | null = null;

/** The expo-notifications module, or null when it cannot be loaded.
 *
 *  Callers must handle null rather than assert it away: null is the ordinary
 *  state in Expo Go, not an error. */
export function getNotifications(): NotificationsModule | null {
  if (!pushAvailable) return null;
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  }
  return cached;
}
