import { useState } from 'react';
import * as Linking from 'expo-linking';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { AuthInput as Input, AuthButton as Button, authStyles } from '@/components/common/AuthForm';
import { authService } from '@/services/auth';
import { colors, fonts } from '@/theme';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const redirectTo = Linking.createURL('reset-password');

  function validate(): boolean {
    if (!email.trim()) {
      setError(t('auth.emailRequired'));
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('authUi.invalidEmail'));
      return false;
    }
    setError('');
    return true;
  }

  async function handleReset() {
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await authService.resetPassword(email.trim(), redirectTo);
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
        <View style={[styles.container, authStyles.container]}>
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            <Text style={styles.successTitle} accessibilityLiveRegion="polite">{t('authUi.checkEmail')}</Text>
            <Text style={styles.successText}>
              {t('authUi.resetSent', { email: email.trim() })}
            </Text>
          </View>
          <Button
            title={t('auth.login')}
            onPress={() => router.replace('/(auth)/login')}
          />
          <Button title={t('authUi.changeEmail')} variant="ghost" onPress={() => setEmailSent(false)} />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <View style={[styles.container, authStyles.container]}>
        <View style={styles.header}>
          <Ionicons name="key-outline" size={48} color={colors.primary} />
          <Text style={styles.title}>{t('auth.resetPassword')}</Text>
          <Text style={styles.description}>
            {t('authUi.resetHint')}
          </Text>
        </View>

        <View style={styles.form}>
          {__DEV__ && <View style={{ gap: 8, marginBottom: 20 }}>
            <Text style={styles.description}>{t('recoveryUi.redirect')}</Text>
            <Text selectable style={styles.successText}>{redirectTo}</Text>
          </View>}
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
            autoComplete="email"
            editable={!isSubmitting}
            returnKeyType="send"
            onSubmitEditing={handleReset}
          />

          <Button
            title={t('auth.resetPassword')}
            onPress={handleReset}
            loading={isSubmitting}
          />

          <Button
            title={t('common.back')}
            onPress={() => router.replace('/(auth)/login')}
            disabled={isSubmitting}
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
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  description: {
    fontSize: 16, fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
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
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  successText: {
    fontSize: 16, fontFamily: fonts.regular,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
