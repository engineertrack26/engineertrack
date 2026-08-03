import { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { joinIssueService, type JoinIssueReason } from '@/services/joinIssue';
import { colors } from '@/theme';

interface Props {
  visible: boolean;
  attemptedCode: string;
  reason: JoinIssueReason;
  onClose: () => void;
}

export function JoinIssueDialog({ visible, attemptedCode, reason, onClose }: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Task 13 mounts this dialog persistently on each screen and only flips
  // `visible`, so component state survives between openings. Without this, a
  // note typed for one code and then cancelled would still be sitting there
  // the next time a DIFFERENT code fails — and would be sent attached to it.
  useEffect(() => {
    if (visible) setNote('');
  }, [visible]);

  async function handleSend() {
    setIsSending(true);
    try {
      const { routedToAdmin } = await joinIssueService.report({
        attemptedCode,
        reason,
        note,
      });
      // Close on acknowledgement rather than before the alert. Presenting an
      // Alert while a Modal is mid-dismissal is swallowed on iOS, which would
      // silently drop the only confirmation the user gets that their report
      // was sent.
      Alert.alert(
        t('errors.reportTitle'),
        routedToAdmin
          ? t('errors.reportSentRouted')
          : t('errors.reportSentStored'),
        [{ text: t('common.done'), onPress: onClose }],
      );
    } catch {
      Alert.alert(t('common.error'), t('errors.reportFailed'));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('errors.reportTitle')}</Text>
          <Text style={styles.meta}>{attemptedCode}</Text>

          <Text style={styles.label}>{t('errors.reportNoteLabel')}</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder={t('errors.reportNotePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={500}
          />

          <View style={styles.actions}>
            <Button
              title={t('common.cancel')}
              onPress={onClose}
              variant="ghost"
              disabled={isSending}
            />
            <Button
              title={t('errors.reportSend')}
              onPress={handleSend}
              loading={isSending}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    color: colors.text,
    backgroundColor: colors.background,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
});
