import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme';

// Auth-only controls: avoid changing in-progress screens that use the shared Input/Button.
export function AuthInput({ label, error, icon, isPassword, ...props }: TextInputProps & {
  label: string; error?: string; icon?: keyof typeof Ionicons.glyphMap; isPassword?: boolean;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 6, marginBottom: 18 }}>
    <Text style={authStyles.label}>{label}</Text>
    <View style={[authStyles.inputRow, focused && { borderColor: colors.primaryDark }, !!error && { borderColor: colors.error }]}>
      {icon && <Ionicons name={icon} size={22} color={colors.primaryDark} />}
      <TextInput {...props} accessibilityLabel={label} accessibilityHint={error}
        secureTextEntry={!!isPassword && !visible}
        onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
        style={[authStyles.input, props.style]} />
      {isPassword && <TouchableOpacity accessibilityRole="button" disabled={props.editable === false}
        accessibilityLabel={t(visible ? 'mentorProfile.hidePassword' : 'mentorProfile.showPassword')}
        onPress={() => setVisible(!visible)} style={authStyles.eye}>
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={24} color={colors.primaryDark} />
      </TouchableOpacity>}
    </View>
    {!!error && <Text accessibilityLiveRegion="polite" style={authStyles.error}>{error}</Text>}
  </View>;
}

export function AuthButton({ title, onPress, loading = false, disabled = false, variant = 'primary', style }: {
  title: string; onPress: () => void; loading?: boolean; disabled?: boolean;
  variant?: 'primary' | 'ghost'; style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
}) {
  return <TouchableOpacity onPress={onPress} disabled={disabled || loading} accessibilityRole="button"
    accessibilityLabel={title} accessibilityState={{ disabled: disabled || loading, busy: loading }}
    style={[authStyles.button, variant === 'primary' && { backgroundColor: colors.primaryDark },
      (disabled || loading) && { opacity: 0.65 }, style]}>
    {loading && <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.primaryDark} />}
    <Text style={{ fontSize: 16, fontWeight: '600', textAlign: 'center', flexShrink: 1,
      color: variant === 'primary' ? '#fff' : colors.primaryDark }}>{title}</Text>
  </TouchableOpacity>;
}

export const authStyles = StyleSheet.create({
  container: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingVertical: 24 },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingLeft: 14,
    paddingRight: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.text, paddingVertical: 14 },
  eye: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  button: { minHeight: 52, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});
