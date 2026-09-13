import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { AuthButton as Button } from '@/components/common/AuthForm';
import { SUPPORTED_LANGUAGES } from '@/utils/constants';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { colors } from '@/theme';
import type { SupportedLanguage } from '@/types/user';

export default function LanguageSelectScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const currentLang = i18n.language;
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function selectLanguage(code: SupportedLanguage) {
    if (pending.current || code === currentLang) return;
    pending.current = true; setSaving(true);
    try {
      if (user?.id) {
        await authService.updateLanguage(user.id, code);
        const current = useAuthStore.getState().user;
        if (current?.id !== user.id) return;
        useAuthStore.getState().setUser({ ...current, language: code });
      }
      await i18n.changeLanguage(code);
    } catch { Alert.alert(t('common.error'), t('common.error')); }
    finally { pending.current = false; setSaving(false); }
  }

  return (
    <ScreenWrapper scroll={false}>
      <View style={styles.container}>
        <FlatList
          ListHeaderComponent={<View style={styles.header}>
            <Ionicons name="globe-outline" size={40} color={colors.primaryDark} />
            <Text style={styles.title} accessibilityRole="header">{t('auth.selectLanguage')}</Text>
          </View>}
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
                disabled={saving}
                accessibilityRole="radio"
                accessibilityState={{ checked: isActive, disabled: saving }}
              >
                <Text style={[styles.langLabel, isActive && styles.langLabelActive]}>
                  {item.label}
                </Text>
                <Ionicons name={isActive ? 'radio-button-on' : 'radio-button-off'} size={24} color={colors.primaryDark} />
              </TouchableOpacity>
            );
          }}
        />

        <Button
          title={t('common.done')}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
          loading={saving}
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
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
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
    minHeight: 56,
    gap: 12,
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
    flex: 1,
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
