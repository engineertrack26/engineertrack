import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ui } from '@/components/common/workflowStyles';
import { REVIEW_NOTE_LIMIT } from '@/utils/mentorReviews';
import { colors } from '@/theme';

interface Props {
  mode: 'revision' | 'note' | null;
  context: string;
  value: string;
  error: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}
export function ReviewNoteSheet({ mode, context, value, error, busy, onChange, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const revision = mode === 'revision';
  const close = () => { if (!busy) onClose(); };
  return <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={{ position: 'absolute', inset: 0 }} accessible={false} onPress={close} />
      <SafeAreaView edges={['bottom', 'left', 'right']} accessibilityViewIsModal
        style={{ maxHeight: '90%', width: '100%', maxWidth: 720, alignSelf: 'center', backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 16 }}>
          <View style={ui.header}>
            <Text accessibilityRole="header" style={[ui.title, { flex: 1 }]}>{t(revision ? 'mentorFlow.requestRevision' : 'mentorFlow.optionalNote')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} accessibilityState={{ disabled: busy }}
              disabled={busy} style={ui.iconButton} onPress={close}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={ui.secondary}>{context}</Text>
          <Text style={ui.label}>{t(revision ? 'mentorFlow.reason' : 'mentor.reviewNote')}{revision ? ' *' : ''}</Text>
          <TextInput multiline value={value} editable={!busy} onChangeText={onChange} maxLength={REVIEW_NOTE_LIMIT}
            accessibilityLabel={t(revision ? 'mentorFlow.reason' : 'mentor.reviewNote') + (revision ? ', ' + t('common.required') : '')}
            style={[ui.input, { minHeight: 144, textAlignVertical: 'top', borderColor: error ? colors.error : colors.textDisabled }]} />
          <Text style={[ui.secondary, { textAlign: 'right' }]}>{value.length}/{REVIEW_NOTE_LIMIT}</Text>
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{t(error)}</Text>}
          {revision && <Text style={ui.secondary}>{t('mentorFlow.reasonHint')}</Text>}
          <Text style={ui.secondary}>{t(revision ? 'mentorFlow.noteToStudent' : 'mentorFlow.noteOnApproval')}</Text>
        </ScrollView>
        <View style={{ padding: 24, paddingTop: 12, borderTopWidth: 1, borderColor: colors.divider, gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onConfirm}
            style={[ui.primary, busy && { opacity: 0.6 }]}>
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={ui.primaryText}>{t(revision ? 'mentorFlow.sendRevision' : 'common.done')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={close}>
            <Text style={[ui.link, { textAlign: 'center' }]}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
