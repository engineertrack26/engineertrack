import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ui } from '@/components/common/workflowStyles';
import { studentCodeService } from '@/services/studentCode';
import { useAuthStore } from '@/store/authStore';
import { normalizeCode, parseStudentCode } from '@/utils/codes';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors } from '@/theme';

export function LinkStudentSheet({ userId, onClose, onLinked }: {
  userId: string; onClose: () => void; onLinked: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const parsed = parseStudentCode(code);
  const close = () => { if (!lock.current) onClose(); };
  const submit = async () => {
    if (lock.current || parsed.kind !== 'valid' || useAuthStore.getState().user?.id !== userId) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await studentCodeService.linkWithCode(parsed.studentCode, 'mentor');
      if (mounted.current && useAuthStore.getState().user?.id === userId) onLinked(result.studentName);
    } catch (err) {
      if (mounted.current) setError(mapRpcError(err instanceof Error ? err.message : '').key);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <Pressable accessible={false} onPress={close} style={{ position: 'absolute', inset: 0 }} />
      <SafeAreaView accessibilityViewIsModal edges={['bottom', 'left', 'right']}
        style={{ backgroundColor: colors.paper, maxHeight: '90%', width: '100%', maxWidth: 720, alignSelf: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 16 }}>
          <View style={ui.header}>
            <Text accessibilityRole="header" style={[ui.section, { flex: 1 }]}>{t('mentorStudents.link')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} disabled={busy} onPress={close} style={ui.iconButton}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={ui.body}>{t('mentorStudents.codeHint')}</Text>
          <Text style={ui.label}>{t('mentorStudents.code')}</Text>
          <TextInput autoFocus autoCapitalize="characters" autoCorrect={false} value={code} editable={!busy}
            onChangeText={value => { setCode(normalizeCode(value).slice(0, 6)); setError(null); }}
            accessibilityLabel={t('mentorStudents.code')} style={ui.input} returnKeyType="done" onSubmitEditing={submit} />
          {!!code && parsed.kind !== 'valid' && <Text style={ui.secondary}>{t('mentorStudents.codeHint')}</Text>}
          {!!error && <Text accessibilityRole="alert" style={[ui.body, { color: colors.error }]}>{t(error)}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || parsed.kind !== 'valid', busy }}
            disabled={busy || parsed.kind !== 'valid'} onPress={submit} style={[ui.primary, (busy || parsed.kind !== 'valid') && { opacity: 0.5 }]}>
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={ui.primaryText}>{t('mentorStudents.link')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={{ minHeight: 48 }}>
            <Text style={[ui.link, { textAlign: 'center' }]}>{t('common.cancel')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
