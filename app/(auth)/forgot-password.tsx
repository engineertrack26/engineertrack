import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { authService } from '@/services/auth';
import { colors } from '@/theme';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  function validate(): boolean {
    if (!email.trim()) {
      setError(t('auth.emailRequired'));
      return false;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError(t('auth.emailRequired'));
      return false;
    }
    setError('');
    return true;
  }

  async function handleReset() {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await authService.resetPassword(email.trim());
      setEmailSent(true);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (emailSent) {
    return (
      <ScreenWrapper>
        <View style={styles.container}>
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            <Text style={styles.successTitle}>{t('auth.resetEmailSent')}</Text>
            <Text style={styles.successText}>
              {email}
            </Text>
          </View>
          <Button
            title={t('auth.login')}
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="key-outline" size={48} color={colors.primary} />
          <Text style={styles.title}>{t('auth.resetPassword')}</Text>
          <Text style={styles.description}>
            Enter your email address and we'll send you a link to reset your password.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            label={t('auth.email')}
            icon="mail-outline"
            placeholder="email@example.com"
            value={email}
            onChangeText={setEmail}
            error={error}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Button
            title={t('auth.resetPassword')}
            onPress={handleReset}
            loading={isSubmitting}
          />

          <Button
            title={t('common.back')}
            onPress={() => router.back()}
            variant="ghost"
            style={styles.backButton}
          />
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
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  form: {
    marginBottom: 24,
  },
  backButton: {
    marginTop: 8,
  },
  successBox: {
    alignItems: 'center',
    marginBottom: 32,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  successText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
