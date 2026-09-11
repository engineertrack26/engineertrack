import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@/theme';

interface LoadFailedBannerProps {
  onRetry: () => void;
}

/** Shown at the top of a screen whose load threw. Without it the initial
 *  empty list or null group renders as the screen's honest empty state --
 *  "no tasks", "no reviews", "not in a group" -- which is a different fact
 *  from "could not load", and one the user acts on differently. Rendered
 *  above whatever is there rather than replacing it, so a refresh that fails
 *  keeps the last good data on screen. */
export function LoadFailedBanner({ onRetry }: LoadFailedBannerProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline-outline" size={20} color={colors.error} />
      <Text style={styles.text}>{t('common.loadFailed')}</Text>
      <TouchableOpacity onPress={onRetry} activeOpacity={0.7} hitSlop={8}>
        <Text style={styles.retry}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error + '12',
    borderWidth: 1,
    borderColor: colors.error + '40',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  retry: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },
});
