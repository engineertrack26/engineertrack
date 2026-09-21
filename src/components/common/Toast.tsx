import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/theme';

/**
 * A quiet confirmation ("Sent", "Saved") that needs no tap to dismiss.
 * `Alert` stays for errors and for anything that asks a question. One host
 * lives in the root layout, so a toast survives the navigation that usually
 * follows a successful action (review-detail → pending list).
 */
type Listener = (message: string) => void;
let listener: Listener | null = null;

export function showToast(message: string) {
  if (listener) listener(message);
}

const VISIBLE_MS = 2500;

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (next) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(next);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true })
          .start(({ finished }) => { if (finished) setMessage(null); });
      }, VISIBLE_MS);
    };
    return () => {
      listener = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [opacity]);

  if (!message) return null;
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" accessibilityRole={Platform.OS === 'ios' ? undefined : 'alert'}
      style={[styles.toast, { bottom: insets.bottom + 72, opacity }]}>
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute', left: 16, right: 16, alignItems: 'center',
    backgroundColor: colors.ink, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  text: { color: colors.textOnPrimary, fontSize: 14, fontFamily: fonts.medium, textAlign: 'center' },
});
