import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/theme';

type BackButtonProps = ({ href: Href; onPress?: never } | { href?: never; onPress: () => void }) & {
  disabled?: boolean;
};

/** Return to the logical parent even when a hidden tab was opened directly. */
export function BackButton({ href, onPress, disabled }: BackButtonProps) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress ?? (() => { if (href) router.replace(href); })}
      style={[styles.button, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name="arrow-back" size={24} color={colors.primary} />
      <Text style={styles.label}>{t('common.back')}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    minHeight: 48, minWidth: 48, gap: spacing.sm, paddingHorizontal: spacing.sm },
  label: { color: colors.primary, fontSize: 16, fontWeight: '600', flexShrink: 1 },
});
