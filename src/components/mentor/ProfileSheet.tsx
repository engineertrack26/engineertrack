import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

export function ProfileSheet({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return <Modal visible transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <Pressable accessible={false} disabled={busy} onPress={onClose} style={{ position: 'absolute', inset: 0 }} />
      <SafeAreaView accessibilityViewIsModal edges={['bottom', 'left', 'right']} style={{ backgroundColor: colors.paper, maxHeight: '90%', width: '100%', maxWidth: 720, alignSelf: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 16 }}>
          <View style={ui.header}>
            <Text accessibilityRole="header" style={[ui.section, { flex: 1 }]}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} disabled={busy} onPress={onClose} style={ui.iconButton}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          {children}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
