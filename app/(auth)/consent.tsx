import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Button } from '@/components/common/Button';
import { authService } from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import { colors } from '@/theme';

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { user, setUser } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleAccept() {
    setIsSubmitting(true);
    try {
      await authService.recordConsent(PRIVACY_POLICY_VERSION);
      if (user) {
        setUser({ ...user, consentVersion: PRIVACY_POLICY_VERSION });
      }
      router.replace('/');
    } catch {
      // Never let the user through without a stored consent.
      Alert.alert(t('common.error'), t('legal.privacy.acceptFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      await authService.signOut();
    } finally {
      router.replace('/(auth)/login');
    }
  }

  // scroll={false}: this screen owns its own ScrollView between a fixed header
  // and fixed actions; ScreenWrapper's default ScrollView would nest them.
  return (
    <ScreenWrapper scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('legal.privacy.updatedTitle')}</Text>
        <Text style={styles.subtitle}>{t('legal.privacy.updatedBody')}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.version}>
          {t('legal.privacy.versionLabel', { version: PRIVACY_POLICY_VERSION })}
        </Text>
        <Text style={styles.body}>{t('legal.privacy.intro')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.dataWeCollectTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.dataWeCollect')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.notCollectedTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.notCollected')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.whyWeCollectTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.whyWeCollect')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.sharingTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.sharing')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.retentionTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.retention')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.yourRightsTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.yourRights')}</Text>

        <Text style={styles.sectionTitle}>{t('legal.privacy.contactTitle')}</Text>
        <Text style={styles.body}>{t('legal.privacy.contact')}</Text>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          title={t('legal.privacy.accept')}
          onPress={handleAccept}
          loading={isSubmitting}
        />
        <Button
          title={t('auth.signOut')}
          onPress={handleSignOut}
          variant="ghost"
          disabled={isSubmitting}
        />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  version: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  actions: {
    gap: 8,
    paddingTop: 12,
  },
});
