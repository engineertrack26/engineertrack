import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { authService } from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';

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
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = t('auth.emailRequired');
    }
    if (!password) {
      newErrors.password = t('auth.passwordRequired');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleLogin() {
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
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('auth.invalidCredentials'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.logo}>EngineerTrack</Text>
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

          <TouchableOpacity
            onPress={() => router.push('/(auth)/forgot-password')}
            style={styles.forgotLink}
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
            Don't have an account?{' '}
          </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity>
              <Text style={styles.footerLink}>{t('auth.register')}</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/language-select')}
          style={styles.langButton}
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
    marginBottom: 40,
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
  forgotLink: {
    alignSelf: 'flex-end',
    marginBottom: 24,
    marginTop: -8,
  },
  forgotText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
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
  langButton: {
    alignSelf: 'center',
    marginTop: 24,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  langText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
