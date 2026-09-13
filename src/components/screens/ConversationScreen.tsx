import { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useMessageStore } from '@/store/messageStore';
import { messageService, MESSAGES_PAGE_SIZE } from '@/services/messages';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { mapRpcError } from '@/utils/rpcErrors';
import { dayGroups } from '@/utils/messageHelpers';
import { LoadFailedBanner } from '@/components/common';
import { MessageBubble } from '@/components/messages';
import { colors, spacing, borderRadius } from '@/theme';
import type { ConversationSummary, Message } from '@/types/messages';

interface Props { role: 'student' | 'mentor' | 'advisor' }
const BODY_MAX = 2000;

export function ConversationScreen({ role }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const user = useAuthStore((s) => s.user);
  const refreshUnread = useMessageStore((s) => s.refreshUnread);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const focused = useRef(false);
  const request = useRef(0);
  const loadingMore = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    const req = ++request.current;
    setLoadFailed(false);
    try {
      const [all, page] = await Promise.all([messageService.listConversations(), messageService.listMessages(id)]);
      if (req !== request.current) return;
      const mine = all.find((c) => c.id === id) ?? null;
      if (!mine) {
        // Deleted under us (membership closed, group archived) or never ours.
        Alert.alert(t('common.error'), t('messages.gone', 'This conversation is no longer available.'));
        if (router.canGoBack()) router.back(); else router.replace(`/(${role})/messages` as never);
        return;
      }
      setSummary(mine);
      setMessages(page);
      setHasMore(page.length === MESSAGES_PAGE_SIZE);
      await messageService.markRead(id);
      void refreshUnread();
    } catch (err) {
      if (req !== request.current) return;
      const { code } = mapRpcError(err instanceof Error ? err.message : '');
      if (code === 'CONVERSATION_NOT_FOUND') {
        Alert.alert(t('common.error'), t('messages.gone', 'This conversation is no longer available.'));
        if (router.canGoBack()) router.back(); else router.replace(`/(${role})/messages` as never);
        return;
      }
      console.error('Conversation load error:', err);
      setLoadFailed(true);
    } finally {
      if (req === request.current) setLoading(false);
    }
  }, [id, router, t, refreshUnread, role]);

  useFocusEffect(useCallback(() => { focused.current = true; load(); return () => { focused.current = false; }; }, [load]));

  // New rows arrive by realtime; RLS decides delivery (a non-participant
  // never receives them). The payload carries the row, and a message row
  // needs no signing or joining, so it is appended directly.
  useRealtimeSubscription({
    table: 'messages',
    event: 'INSERT',
    filter: id ? `conversation_id=eq.${id}` : undefined,
    enabled: !!id,
    onPayload: (payload) => {
      const row = (payload as { new?: Record<string, unknown> }).new;
      if (!row?.id) return;
      const incoming: Message = { id: row.id as string, senderId: row.sender_id as string, body: (row.body as string) || '', createdAt: row.created_at as string };
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
      if (focused.current && id && incoming.senderId !== user?.id) {
        messageService.markRead(id).then(() => refreshUnread()).catch(() => undefined);
      }
    },
  });

  async function loadMore() {
    if (!id || !hasMore || messages.length === 0 || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const older = await messageService.listMessages(id, messages[0].createdAt);
      const seen = new Set(messages.map((m) => m.id));
      setMessages((prev) => [...older.filter((m) => !seen.has(m.id)), ...prev]);
      setHasMore(older.length === MESSAGES_PAGE_SIZE);
    } catch (err) {
      console.warn('Older messages load failed:', err instanceof Error ? err.message : err);
    } finally {
      loadingMore.current = false;
    }
  }

  async function send() {
    const body = text.trim();
    if (!id || !body || sending || !user) return;
    setSending(true);
    try {
      const newId = await messageService.sendMessage(id, body);
      // Shown immediately rather than waiting for the realtime echo, which is
      // absorbed by the same id-dedupe the realtime handler uses.
      setMessages((prev) => (prev.some((m) => m.id === newId) ? prev : [...prev, { id: newId, senderId: user.id, body, createdAt: new Date().toISOString() }]));
      setText('');
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSending(false);
    }
  }

  function toggleBlock() {
    if (!summary || !id) return;
    const block = !summary.blockedByMe;
    const doIt = async () => {
      try {
        await messageService.setBlocked(id, block);
        setSummary({ ...summary, blockedByMe: block });
      } catch (err) {
        const { key } = mapRpcError(err instanceof Error ? err.message : '');
        Alert.alert(t('common.error'), t(key));
      }
    };
    if (!block) { void doIt(); return; }
    Alert.alert(t('messages.block', 'Block'), t('messages.blockConfirm', '{{name}} will no longer be able to message you. You keep the conversation.', { name: summary.otherName }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('messages.block', 'Block'), style: 'destructive', onPress: () => void doIt() },
    ]);
  }

  const canBlock = summary && summary.otherRole !== 'advisor' && role !== 'advisor';
  const groups = dayGroups(messages, i18n.language);
  // Oldest first, day label before that day's messages -- the natural
  // top-to-bottom reading order. Rendered in an INVERTED list, so it is
  // reversed below: inverted lays out index 0 at the bottom of the screen
  // and stacks each following index above it, which puts this array's last
  // element (the oldest day's label) at the top once reversed back by the
  // layout -- i.e. reversing `flat` and inverting the list cancel out, and
  // the screen reads top-to-bottom exactly as `flat` is ordered here, newest
  // message at the bottom where a chat conversation opens.
  const flat = groups.flatMap((g) => [{ type: 'day' as const, key: g.key, label: g.label }, ...g.messages.map((m) => ({ type: 'msg' as const, key: m.id, message: m }))]);
  const flatReversed = [...flat].reverse();

  if (!user) return null;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}><Ionicons name="chevron-back" size={26} color={colors.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{summary?.otherName ?? ''}</Text>
          {!!summary && <Text style={styles.meta} numberOfLines={1}>{summary.groupName}</Text>}
        </View>
        {canBlock && (
          <TouchableOpacity onPress={toggleBlock} hitSlop={8}>
            <Text style={styles.blockText}>{summary?.blockedByMe ? t('messages.unblock', 'Unblock') : t('messages.block', 'Block')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loadFailed && <View style={{ paddingHorizontal: spacing.lg }}><LoadFailedBanner onRetry={load} /></View>}
        {loading ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={flatReversed}
            inverted
            keyExtractor={(x) => x.key}
            renderItem={({ item }) => item.type === 'day'
              ? <Text style={styles.day}>{item.label}</Text>
              : <MessageBubble message={item.message} mine={item.message.senderId === user.id} locale={i18n.language} />}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.2}
          />
        )}
        {summary?.blockedMe ? (
          <View style={styles.blockedBar}><Text style={styles.blockedText}>{t('messages.blocked', "You can't message this person.")}</Text></View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput style={styles.input} placeholder={t('messages.placeholder', 'Write a message…')} placeholderTextColor={colors.textSecondary} value={text} onChangeText={(v) => setText(v.slice(0, BODY_MAX))} multiline editable={!sending} />
            <TouchableOpacity onPress={send} disabled={sending || !text.trim()} hitSlop={8} accessibilityLabel={t('messages.send', 'Send')}>
              {sending ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="send" size={22} color={text.trim() ? colors.primary : colors.textDisabled} />}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textSecondary },
  blockText: { fontSize: 14, fontWeight: '600', color: colors.error },
  list: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  day: { alignSelf: 'center', fontSize: 11, color: colors.textSecondary, marginVertical: spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 120, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: 8 },
  blockedBar: { padding: spacing.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.divider },
  blockedText: { fontSize: 13, color: colors.textSecondary },
});
