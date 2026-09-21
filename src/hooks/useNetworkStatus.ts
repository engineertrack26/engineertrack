import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * `true` only when the device reports NO connection; unknown counts as
 * online so a slow probe never shows the banner by mistake. NetInfo's
 * `isInternetReachable` is null until its first probe answers.
 */
let offline = false;
const listeners = new Set<(offline: boolean) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  NetInfo.addEventListener((state) => {
    const next = state.isConnected === false || state.isInternetReachable === false;
    if (next === offline) return;
    offline = next;
    listeners.forEach((listen) => listen(offline));
  });
}

export function isOffline(): boolean {
  return offline;
}

export function useNetworkStatus(): { offline: boolean } {
  const [value, setValue] = useState(offline);
  useEffect(() => {
    start();
    listeners.add(setValue);
    setValue(offline);
    return () => { listeners.delete(setValue); };
  }, []);
  return { offline: value };
}
