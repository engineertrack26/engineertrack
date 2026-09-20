import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { AuthBrand } from '@/components/common/AuthBrand';
import { AuthInput as Input, AuthButton as Button, authStyles } from '@/components/common/AuthForm';
import { authService } from '@/services/auth';
import { authErrorKey } from '@/utils/authErrors';
import { isPasswordPwned } from '@/services/pwnedPasswords';
import { useAuthStore } from '@/store/authStore';
import { colors, fonts } from '@/theme';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import type { UserRole, SupportedLanguage } from '@/types/user';
import type { StudentAvatarId } from '@/utils/studentAvatar';
import { RegistrationAvatar } from '@/components/student/RegistrationAvatar';

const ROLES: { key: UserRole; icon: string; color?: string }[] = [
  { key: 'student', icon: '🎓' },
  { key: 'mentor', icon: '👨‍🏫' },
  { key: 'advisor', icon: '📋' },
];

export default function RegisterScreen() {
  const { t, i18n } = useTranslation();
  const { setUser, setSession } = useAuthStore();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [avatarId, setAvatarId] = useState<StudentAvatarId | null>(null);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!firstName.trim()) {
      newErrors.firstName = t('authUi.required', { field: t('auth.firstName') });
    }
    if (!lastName.trim()) {
      newErrors.lastName = t('authUi.required', { field: t('auth.lastName') });
    }
    if (!email.trim()) {
      newErrors.email = t('auth.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = t('authUi.invalidEmail');
    }
    if (!password) {
      newErrors.password = t('auth.passwordRequired');
    } else if (password.length < 6) {
      newErrors.password = t('authUi.passwordHint');
    }
    if (password !== confirmPassword) {
      newErrors.confirmPassword = t('auth.passwordMismatch');
    }

    if (!consentAccepted) {
      newErrors.consent = t('legal.privacy.consentCheckbox');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleRegister() {
    if (isSubmitting) return;
    if (!validate()) {
      Alert.alert(
        t('common.error'),
        t('auth.fillAllFields', 'Please fill in all required fields correctly.'),
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (await isPasswordPwned(password)) {
        setErrors({ password: t('authUi.weakPassword') });
        return;
      }
      const currentLang = i18n.language as SupportedLanguage;
      const { session, user } = await authService.signUp({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
        language: currentLang,
        consentVersion: PRIVACY_POLICY_VERSION,
        avatarId: role === 'student' ? avatarId : null,
      });

      if (session && user) {
        const profile = await authService.getProfileWithRetry(user.id);
        setSession(session);
        setUser(profile);
        router.replace('/');
      } else {
        Alert.alert(
          t('auth.registerSuccess'),
          t('auth.registerSuccess'),
        );
        router.replace('/(auth)/login');
      }
    } catch (error) {
      Alert.alert(t('common.error'), t(authErrorKey(error)));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenWrapper>
      <View style={[styles.container, authStyles.container]}>
        <View style={styles.header}>
          <AuthBrand />
          <Text style={styles.subtitle}>{t('auth.register')}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.nameRow}>
            <View style={styles.nameField}>
              <Input
                label={t('auth.firstName')}
                icon="person-outline"
                placeholder={t('auth.firstName')}
                value={firstName}
                onChangeText={setFirstName}
                error={errors.firstName}
                autoCapitalize="words"
                autoComplete="given-name"
                editable={!isSubmitting}
              />
            </View>
            <View style={styles.nameField}>
              <Input
                label={t('auth.lastName')}
                icon="person-outline"
                placeholder={t('auth.lastName')}
                value={lastName}
                onChangeText={setLastName}
                error={errors.lastName}
                autoCapitalize="words"
                autoComplete="family-name"
                editable={!isSubmitting}
              />
            </View>
          </View>

          <Input
            label={t('auth.email')}
            icon="mail-outline"
            placeholder="email@example.com"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!isSubmitting}
          />

          <Input
            label={t('auth.password')}
            icon="lock-closed-outline"
            placeholder="********"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            isPassword
            autoComplete="new-password"
            editable={!isSubmitting}
          />
          <Text style={styles.passwordHint}>{t('authUi.passwordHint')}</Text>

          <Input
            label={t('auth.confirmPassword')}
            icon="lock-closed-outline"
            placeholder="********"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={errors.confirmPassword}
            isPassword
            autoComplete="new-password"
            editable={!isSubmitting}
            returnKeyType="done"
          />

          {/* Role Selection */}
          <Text style={styles.label}>{t('auth.role')}</Text>
          <View style={styles.roleRow}>
            {ROLES.map((item) => {
              const isActive = role === item.key;
              const activeColor = item.color || colors.primary;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.roleCard,
                    isActive && [styles.roleCardActive, item.color ? { borderColor: activeColor, backgroundColor: activeColor + '15' } : undefined],
                  ]}
                  onPress={() => setRole(item.key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isActive, disabled: isSubmitting }}
                  disabled={isSubmitting}
                >
                  <Text style={styles.roleIcon}>{item.icon}</Text>
                  <Text
                    style={[
                      styles.roleText,
                      isActive && [styles.roleTextActive, item.color ? { color: activeColor } : undefined],
                    ]}
                  >
                    {t(`auth.${item.key}`)}
                  </Text>
                  <Ionicons name={isActive ? 'radio-button-on' : 'radio-button-off'} size={24} color={isActive ? colors.primaryDark : colors.textSecondary} />
                </TouchableOpacity>
              );
            })}
          </View>

          {role === 'student' && <RegistrationAvatar value={avatarId} onChange={setAvatarId} disabled={isSubmitting} />}
          <View style={styles.consentRow}>
            <TouchableOpacity
              onPress={() => setConsentAccepted((value) => !value)}
              style={styles.checkbox}
              accessibilityRole="checkbox"
              accessibilityLabel={t('legal.privacy.consentCheckbox')}
              disabled={isSubmitting}
              accessibilityState={{ checked: consentAccepted }}
            >
              <Ionicons
                name={consentAccepted ? 'checkbox' : 'square-outline'}
                size={22}
                color={consentAccepted ? colors.primary : colors.textSecondary}
              />
            </TouchableOpacity>
            <View
              style={styles.consentTextWrap}
            >
              <Text style={styles.consentText}>
                {t('legal.privacy.consentCheckbox')}
              </Text>
              <TouchableOpacity accessibilityRole="button" disabled={isSubmitting} style={styles.policyLink}
                onPress={() => router.push('/(auth)/privacy-policy')}>
                <Text style={styles.consentLink}>{t('legal.privacy.readPolicy')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {errors.consent && <Text style={styles.errorText}>{errors.consent}</Text>}

          <Button
            title={t('auth.register')}
            onPress={handleRegister}
            loading={isSubmitting}
            disabled={!consentAccepted}
            style={styles.registerButton}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t('authUi.hasAccount')}
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={authStyles.button} accessibilityRole="button" disabled={isSubmitting}>
              <Text style={styles.footerLink}>{t('auth.login')}</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  subtitle: {
    fontSize: 18, fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  form: {
    marginBottom: 24,
  },
  nameRow: {
    flexDirection: 'column',
  },
  nameField: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '500', fontFamily: fonts.medium,
    color: colors.text,
    marginBottom: 8,
  },
  roleRow: {
    flexDirection: 'column',
    gap: 10,
    marginBottom: 24,
  },
  roleCard: {
    flexDirection: 'row',
    minHeight: 56,
    gap: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.paper,
  },
  roleCardActive: {
    borderColor: colors.ink,
    backgroundColor: colors.inkBg,
  },
  roleIcon: {
    fontSize: 24, fontFamily: fonts.regular,
    marginBottom: 4,
  },
  roleText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500', fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  roleTextActive: {
    color: colors.primary,
    fontWeight: '600', fontFamily: fonts.semibold,
  },
  registerButton: {
    marginTop: 4,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 16,
  },
  checkbox: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentTextWrap: {
    flex: 1,
  },
  consentText: {
    fontSize: 15, fontFamily: fonts.regular,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  consentLink: {
    fontSize: 16,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.primary,
    marginTop: 2,
  },
  errorText: {
    fontSize: 12, fontFamily: fonts.regular,
    color: colors.error,
    marginTop: 4,
    marginLeft: 30,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14, fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.primary,
  },
  passwordHint: { fontSize: 14, fontFamily: fonts.regular, lineHeight: 21, color: colors.textSecondary, marginTop: -8, marginBottom: 18 },
  policyLink: { minHeight: 48, justifyContent: 'center' },
});
