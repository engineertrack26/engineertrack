import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { PRIVACY_POLICY_VERSION } from '@/utils/constants';
import { colors } from '@/theme';

function Section({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {body.split('\n').map((line, index) => (
        <Text key={index} style={styles.sectionBody}>
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('legal.privacy.title')}</Text>
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
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  scrollBody: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  version: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginBottom: 8,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: 6,
  },
});
