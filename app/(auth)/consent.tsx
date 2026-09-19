import { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { AuthButton as Button } from '@/components/common/AuthForm';
import { authService } from '@/services/auth';
import { useAuthStore } from '@/store/authStore';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import { colors, fonts } from '@/theme';

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { user, setUser } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const pending = useRef(false);

  async function handleAccept() {
    if (pending.current || !user?.id) return;
    pending.current = true;
    setIsSubmitting(true);
    try {
      await authService.recordConsent(PRIVACY_POLICY_VERSION);
      const current = useAuthStore.getState().user;
      if (current?.id !== user.id) return;
      setUser({ ...current, consentVersion: PRIVACY_POLICY_VERSION });
      router.replace('/');
    } catch {
      // Never let the user through without a stored consent.
      Alert.alert(t('common.error'), t('legal.privacy.acceptFailed'));
    } finally {
      pending.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (pending.current) return;
    pending.current = true;
    setIsSigningOut(true);
    try {
      await authService.signOut();
      router.replace('/(auth)/login');
    } catch { Alert.alert(t('common.error'), t('common.error')); }
    finally { pending.current = false; setIsSigningOut(false); }
  }

  // scroll={false}: this screen owns its own ScrollView between a fixed header
  // and fixed actions; ScreenWrapper's default ScrollView would nest them.
  return (
    <ScreenWrapper scroll={false}>
      <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">{t('legal.privacy.updatedTitle')}</Text>
        <Text style={styles.subtitle}>{t('legal.privacy.updatedBody')}</Text>
      </View>

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
          disabled={isSigningOut}
        />
        <Button
          title={t('auth.signOut')}
          onPress={handleSignOut}
          variant="ghost"
          disabled={isSubmitting}
          loading={isSigningOut}
        />
      </View>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center', paddingTop: 16 },
  header: {
    paddingBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16, fontFamily: fonts.regular,
    lineHeight: 24,
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  version: {
    fontSize: 13, fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 28,
    marginBottom: 6,
  },
  body: {
    fontSize: 16, fontFamily: fonts.regular,
    lineHeight: 25,
    color: colors.text,
  },
  actions: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
