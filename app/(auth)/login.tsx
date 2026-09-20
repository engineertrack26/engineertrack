import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { AuthBrand } from '@/components/common/AuthBrand';
import { AuthInput as Input, AuthButton as Button, authStyles } from '@/components/common/AuthForm';
import { authService } from '@/services/auth';
import { authErrorKey } from '@/utils/authErrors';
import { useAuthStore } from '@/store/authStore';
import { colors, fonts } from '@/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { setUser, setSession } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    const newErrors: typeof errors = {};
    if (!email.trim()) {
      newErrors.email = t('auth.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = t('authUi.invalidEmail');
    }
    if (!password) {
      newErrors.password = t('auth.passwordRequired');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleLogin() {
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const { session, user } = await authService.signIn({ email: email.trim(), password });
      if (session && user) {
        const profile = await authService.getProfileWithRetry(user.id);
        setSession(session);
        setUser(profile);
        router.replace('/');
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
          <Text style={styles.subtitle}>{t('auth.login')}</Text>
        </View>

        <View style={styles.form}>
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
            autoComplete="current-password"
            editable={!isSubmitting}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity
            onPress={() => router.push('/(auth)/forgot-password')}
            style={styles.forgotLink}
            accessibilityRole="button"
            disabled={isSubmitting}
          >
            <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
          </TouchableOpacity>

          <Button
            title={t('auth.login')}
            onPress={handleLogin}
            loading={isSubmitting}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t('authUi.noAccount')}
          </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity style={authStyles.button} accessibilityRole="button" disabled={isSubmitting}>
              <Text style={styles.footerLink}>{t('auth.register')}</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/language-select')}
          style={styles.langButton}
          accessibilityRole="button"
          disabled={isSubmitting}
        >
          <Text style={styles.langText}>{t('common.language')}</Text>
        </TouchableOpacity>
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
    marginBottom: 24,
  },
  subtitle: {
    fontSize: 18, fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  form: {
    marginBottom: 24,
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginBottom: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  forgotText: {
    fontSize: 16,
    color: colors.primaryDark,
    fontWeight: '500', fontFamily: fonts.medium,
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
  langButton: {
    alignSelf: 'center',
    marginTop: 24,
    paddingVertical: 14,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  langText: {
    fontSize: 14, fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
});
