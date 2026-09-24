import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ui } from '@/components/common/workflowStyles';
import { BROADCAST_MAX_BODY } from '@/utils/broadcast';
import { colors, fonts } from '@/theme';

interface Props {
  visible: boolean;
  count: number;
  busy: boolean;
  onSend: (body: string) => void;
  onClose: () => void;
}

/** The text of a broadcast, written once and sent to everyone picked. Each
 *  recipient gets it as an ordinary private message; nobody sees the others. */
export function BroadcastComposer({ visible, count, busy, onSend, onClose }: Props) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const left = BROADCAST_MAX_BODY - body.trim().length;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={busy ? () => {} : onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={ui.section}>
              {t('messages.broadcastTitle', 'Message to {{count}} students', { count })}
            </Text>
            <Text style={ui.secondary}>
              {t('messages.broadcastHint', 'Each one gets it as a private message. They do not see the other recipients, and a reply comes only to you.')}
            </Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              editable={!busy}
              multiline
              autoFocus
              maxLength={BROADCAST_MAX_BODY}
              placeholder={t('messages.broadcastPlaceholder', 'Write your message')}
              placeholderTextColor={colors.textSecondary}
              style={{
                minHeight: 160, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.rule,
                borderRadius: 6, padding: 14, fontSize: 16, fontFamily: fonts.regular, color: colors.text,
                backgroundColor: colors.paper,
              }}
            />
            <Text style={[ui.secondary, { textAlign: 'right' }]}>{left}</Text>
            <Pressable accessibilityRole="button" style={[ui.primary, (busy || !body.trim()) && { opacity: 0.4 }]}
              disabled={busy || !body.trim()} onPress={() => onSend(body)}>
              {busy ? <ActivityIndicator color={colors.textOnPrimary} />
                : <Text style={ui.primaryText}>{t('messages.broadcastSend', 'Send to {{count}}', { count })}</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={ui.link}>{t('common.cancel')}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
