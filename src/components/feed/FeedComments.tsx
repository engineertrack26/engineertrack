import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { feedService } from '@/services/feed';
import { colors, spacing, borderRadius } from '@/theme';
import type { FeedComment } from '@/types/feed';

interface Props {
  postId: string;
  userId: string;
  /** The group's advisor may remove any comment; everyone removes their own. */
  canModerate: boolean;
  onCountChange: (delta: number) => void;
}

const MAX = 2000;

export function FeedComments({ postId, userId, canModerate, onCountChange }: Props) {
  const { t } = useTranslation();
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  // A failed fetch is not an empty thread. comments stays null and this flag
  // swaps the spinner for a retry line, so "No comments yet" never stands in
  // for a load error.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    feedService.listComments(postId)
      .then((list) => { if (alive) setComments(list); })
      .catch((err) => {
        console.warn('Feed comments load failed:', err instanceof Error ? err.message : err);
        if (alive) setLoadFailed(true);
      });
    return () => { alive = false; };
  }, [postId, loadAttempt]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await feedService.addComment(postId, userId, body);
      setText('');
      const list = await feedService.listComments(postId);
      setComments(list);
      onCountChange(1);
    } catch (err) {
      console.warn('Feed comment failed:', err instanceof Error ? err.message : err);
      Alert.alert(t('common.error'), t('feed.postFailed'));
    } finally {
      setSending(false);
    }
  }

  function remove(c: FeedComment) {
    Alert.alert(t('feed.removeComment'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.remove'), style: 'destructive',
        onPress: async () => {
          try {
            await feedService.deleteComment(c.id);
            setComments((prev) => (prev || []).filter((x) => x.id !== c.id));
            onCountChange(-1);
          } catch (err) {
            console.warn('Feed comment delete failed:', err instanceof Error ? err.message : err);
            Alert.alert(t('common.error'), t('feed.removeFailed'));
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      {loadFailed && comments === null ? (
        <View style={styles.failedRow}>
          <Text style={styles.empty}>{t('common.loadFailed')}</Text>
          <TouchableOpacity onPress={() => setLoadAttempt((n) => n + 1)} hitSlop={8}>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : comments === null ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : comments.length === 0 ? (
        <Text style={styles.empty}>{t('feed.noComments')}</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.row}>
            <View style={styles.bubble}>
              <Text style={styles.author}>{c.authorName}</Text>
              <Text style={styles.body}>{c.body}</Text>
            </View>
            {(canModerate || c.authorId === userId) && (
              <TouchableOpacity onPress={() => remove(c)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={colors.textDisabled} />
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={t('feed.writeComment')}
          placeholderTextColor={colors.textSecondary}
          value={text}
          onChangeText={(v) => setText(v.slice(0, MAX))}
          multiline
        />
        <TouchableOpacity onPress={send} disabled={sending || !text.trim()} hitSlop={8}>
          {sending
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="send" size={20} color={text.trim() ? colors.primary : colors.textDisabled} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  empty: { fontSize: 13, color: colors.textSecondary },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  retry: { fontSize: 13, fontWeight: '600', color: colors.primary },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bubble: { flex: 1, backgroundColor: colors.background, borderRadius: borderRadius.md, padding: spacing.sm },
  author: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 2 },
  body: { fontSize: 14, color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1, fontSize: 14, color: colors.text, maxHeight: 100,
    borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
});
