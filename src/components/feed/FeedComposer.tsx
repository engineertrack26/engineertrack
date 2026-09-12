import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { feedService } from '@/services/feed';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors, spacing, borderRadius } from '@/theme';

interface Props {
  visible: boolean;
  kind: 'announcement' | 'poll';
  groupId: string;
  onClose: () => void;
  onPosted: () => void;
}

const BODY_MAX = 2000;
const QUESTION_MAX = 200;
const OPTION_MAX = 80;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export function FeedComposer({ visible, kind, groupId, onClose, onPosted }: Props) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [posting, setPosting] = useState(false);
  const max = kind === 'poll' ? QUESTION_MAX : BODY_MAX;

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canPost = body.trim().length > 0 && (kind === 'announcement' || (filled.length >= MIN_OPTIONS && filled.length <= MAX_OPTIONS));

  function reset() {
    setBody('');
    setOptions(['', '']);
  }

  async function post() {
    if (!canPost || posting) return;
    setPosting(true);
    try {
      await feedService.createPost(groupId, kind, body.trim(), kind === 'poll' ? filled : undefined);
      reset();
      onPosted();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setPosting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{kind === 'poll' ? t('feed.createPoll') : t('feed.writeAnnouncement')}</Text>
          <TouchableOpacity onPress={post} disabled={!canPost || posting} hitSlop={8}>
            {posting
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={[styles.postBtn, !canPost && styles.postBtnDisabled]}>{t('feed.post')}</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.body}
            placeholder={kind === 'poll' ? t('feed.composerQuestionPlaceholder') : t('feed.composerBodyPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={body}
            onChangeText={(v) => setBody(v.slice(0, max))}
            multiline
            autoFocus
          />
          <Text style={styles.counter}>{t('feed.charCount', { count: body.length, max })}</Text>

          {kind === 'poll' && (
            <View style={styles.options}>
              {options.map((o, i) => (
                <View key={i} style={styles.optionRow}>
                  <TextInput
                    style={styles.optionInput}
                    placeholder={t('feed.optionPlaceholder', { index: i + 1 })}
                    placeholderTextColor={colors.textSecondary}
                    value={o}
                    onChangeText={(v) => setOptions((prev) => prev.map((x, j) => (j === i ? v.slice(0, OPTION_MAX) : x)))}
                  />
                  {options.length > MIN_OPTIONS && (
                    <TouchableOpacity onPress={() => setOptions((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color={colors.textDisabled} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {options.length < MAX_OPTIONS && (
                <TouchableOpacity style={styles.addOption} onPress={() => setOptions((prev) => [...prev, ''])} activeOpacity={0.7}>
                  <Ionicons name="add" size={18} color={colors.primary} />
                  <Text style={styles.addOptionText}>{t('feed.addOption')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  postBtn: { fontSize: 16, fontWeight: '600', color: colors.primary },
  postBtnDisabled: { color: colors.textDisabled },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  body: { minHeight: 120, fontSize: 16, color: colors.text, textAlignVertical: 'top' },
  counter: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  options: { gap: spacing.sm, marginTop: spacing.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionInput: { flex: 1, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  addOptionText: { fontSize: 14, color: colors.primary, fontWeight: '500' },
});
