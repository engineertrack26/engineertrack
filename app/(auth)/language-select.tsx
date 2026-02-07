import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Button } from '@/components/common/Button';
import { SUPPORTED_LANGUAGES } from '@/utils/constants';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { colors } from '@/theme';
import type { SupportedLanguage } from '@/types/user';

export default function LanguageSelectScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const currentLang = i18n.language;

  async function selectLanguage(code: SupportedLanguage) {
    await i18n.changeLanguage(code);
    if (user?.id) {
      try {
        await authService.updateLanguage(user.id, code);
      } catch {
        // Language saved locally even if remote update fails
      }
    }
  }

  return (
    <ScreenWrapper scroll={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="globe-outline" size={48} color={colors.primary} />
          <Text style={styles.title}>{t('auth.selectLanguage')}</Text>
        </View>

        <FlatList
          data={SUPPORTED_LANGUAGES}
          keyExtractor={(item) => item.code}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isActive = currentLang === item.code;
            return (
              <TouchableOpacity
                style={[styles.langCard, isActive && styles.langCardActive]}
                onPress={() => selectLanguage(item.code)}
                activeOpacity={0.7}
              >
                <Text style={[styles.langLabel, isActive && styles.langLabelActive]}>
                  {item.label}
                </Text>
                {isActive && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          }}
        />

        <Button
          title={t('common.done')}
          onPress={() => router.back()}
          style={styles.doneButton}
        />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
  },
  list: {
    paddingBottom: 16,
  },
  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  langCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#e8f0fe',
  },
  langLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  langLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  doneButton: {
    marginTop: 8,
    marginBottom: 16,
  },
});
