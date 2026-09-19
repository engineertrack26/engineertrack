import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius, fonts } from '@/theme';
import type { ClosureStatus } from '@/types/closure';

interface ClosureBannerProps {
  status: ClosureStatus | null;
  onReport: () => void;
}

/** A persistent lock notice for screens whose record just went read-only
 *  (My tasks, Internship days, Messages, growth) -- see the design's §6
 *  "Student" row. Renders nothing unless the internship is currently
 *  closed. */
export function ClosureBanner({ status, onReport }: ClosureBannerProps) {
  const { t } = useTranslation();
  if (!status?.closed) return null;
  return (
    <View style={styles.bar}>
      <Ionicons name="lock-closed-outline" size={20} color={colors.text} />
      <Text style={styles.text}>{t('closure.banner', 'Your internship is closed — records are read-only')}</Text>
      <Pressable accessibilityRole="button" onPress={onReport} hitSlop={8}>
        <Text style={styles.link}>{t('closure.myReport', 'My report')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warning + '22',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: { flex: 1, fontSize: 13, fontFamily: fonts.regular, color: colors.text },
  link: { fontSize: 13, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text, textDecorationLine: 'underline' },
});
