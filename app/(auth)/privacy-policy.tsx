import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import { colors, fonts } from '@/theme';

function Section({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {body.split('\n').map((line, index) => (
        <Text key={index} style={styles.sectionBody} selectable>
          {line}
        </Text>
      ))}
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const { t } = useTranslation();

  // scroll={false}: ScreenWrapper scrolls by default, and a ScrollView nested
  // in a same-axis ScrollView does not scroll reliably on Android — which on a
  // legal notice means the user cannot reach the end of the text.
  return (
    <ScreenWrapper scroll={false}>
      <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backButton}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('legal.privacy.title')}</Text>
      </View>

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.content}>
        <Text style={styles.version}>
          {t('legal.privacy.versionLabel', { version: PRIVACY_POLICY_VERSION })}
        </Text>
        <Text style={styles.intro}>{t('legal.privacy.intro')}</Text>

        <Section
          title={t('legal.privacy.dataWeCollectTitle')}
          body={t('legal.privacy.dataWeCollect')}
        />
        <Section
          title={t('legal.privacy.notCollectedTitle')}
          body={t('legal.privacy.notCollected')}
        />
        <Section
          title={t('legal.privacy.whyWeCollectTitle')}
          body={t('legal.privacy.whyWeCollect')}
        />
        <Section
          title={t('legal.privacy.sharingTitle')}
          body={t('legal.privacy.sharing')}
        />
        <Section
          title={t('legal.privacy.retentionTitle')}
          body={t('legal.privacy.retention')}
        />
        <Section
          title={t('legal.privacy.yourRightsTitle')}
          body={t('legal.privacy.yourRights')}
        />
        <Section
          title={t('legal.privacy.contactTitle')}
          body={t('legal.privacy.contact')}
        />
      </ScrollView>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center', paddingTop: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
  },
  backButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
  },
  scrollBody: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  version: {
    fontSize: 13, fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  intro: {
    fontSize: 16, fontFamily: fonts.regular,
    lineHeight: 25,
    color: colors.text,
    marginBottom: 8,
  },
  section: {
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 16, fontFamily: fonts.regular,
    lineHeight: 25,
    color: colors.text,
    marginBottom: 6,
  },
});
