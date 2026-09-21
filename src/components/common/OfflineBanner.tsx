import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors, fonts } from '@/theme';

/** One line under the status bar while the device has no connection, so a
 *  failed load reads as "no internet" rather than "the app is broken". */
export function OfflineBanner() {
  const { offline } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  if (!offline) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.banner, { paddingTop: insets.top + 6 }]}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.textOnPrimary} />
      <Text style={styles.text}>{t('common.offline', 'No internet connection')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.ink, paddingBottom: 6, paddingHorizontal: 16,
  },
  text: { color: colors.textOnPrimary, fontSize: 13, fontFamily: fonts.medium },
});
