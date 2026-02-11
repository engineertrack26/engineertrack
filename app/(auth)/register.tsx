import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { authService, isEduEmail } from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';
import type { UserRole, SupportedLanguage } from '@/types/user';

const ROLES: { key: UserRole; icon: string; color?: string }[] = [
  { key: 'student', icon: '🎓' },
  { key: 'mentor', icon: '👨‍🏫' },
  { key: 'advisor', icon: '📋' },
  { key: 'admin', icon: '🏛️', color: '#e65100' },
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
  const [eduEmail, setEduEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!firstName.trim()) {
      newErrors.firstName = t('auth.emailRequired').replace(
        t('auth.email'),
        t('auth.firstName'),
      );
    }
    if (!lastName.trim()) {
      newErrors.lastName = t('auth.emailRequired').replace(
        t('auth.email'),
        t('auth.lastName'),
      );
    }
    if (!email.trim()) {
      newErrors.email = t('auth.emailRequired');
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = t('auth.emailRequired');
    }
    if (!password) {
      newErrors.password = t('auth.passwordRequired');
    } else if (password.length < 6) {
      newErrors.password = t('auth.passwordRequired');
    }
    if (password !== confirmPassword) {
      newErrors.confirmPassword = t('auth.passwordMismatch');
    }

    if (role === 'admin') {
      if (!eduEmail.trim()) {
        newErrors.eduEmail = 'Educational email is required for admin';
      } else if (!isEduEmail(eduEmail)) {
        newErrors.eduEmail = 'Must be a .edu or .edu.tr email address';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleRegister() {
    if (!validate()) {
      Alert.alert(
        t('common.error'),
        t('auth.fillAllFields') || 'Please fill in all required fields correctly.',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const currentLang = i18n.language as SupportedLanguage;
      const { session, user } = await authService.signUp({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
        language: currentLang,
        eduEmail: role === 'admin' ? eduEmail.trim() : undefined,
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
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('common.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.logo}>EngineerTrack</Text>
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
          />

          <Input
            label={t('auth.password')}
            icon="lock-closed-outline"
            placeholder="********"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            isPassword
          />

          <Input
            label={t('auth.confirmPassword')}
            icon="lock-closed-outline"
            placeholder="********"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={errors.confirmPassword}
            isPassword
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
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Admin .edu Email */}
          {role === 'admin' && (
            <Input
              label="Educational Email (.edu)"
              icon="school-outline"
              placeholder="admin@university.edu"
              value={eduEmail}
              onChangeText={setEduEmail}
              error={errors.eduEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

          <Button
            title={t('auth.register')}
            onPress={handleRegister}
            loading={isSubmitting}
            style={styles.registerButton}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Already have an account?{' '}
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
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
  logo: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: colors.textSecondary,
  },
  form: {
    marginBottom: 24,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameField: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 8,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  roleCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#e8f0fe',
  },
  roleIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  roleText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  roleTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  registerButton: {
    marginTop: 4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});
