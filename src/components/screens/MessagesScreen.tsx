import { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useMessageStore } from '@/store/messageStore';
import { messageService } from '@/services/messages';
import { groupService } from '@/services/group';
import { useClosureStatus } from '@/hooks/useClosureStatus';
import { mapRpcError } from '@/utils/rpcErrors';
import { broadcastFormError, broadcastSummary, toggleRecipient } from '@/utils/broadcast';
import { showToast } from '@/components/common/Toast';
import { ClosureBanner, LoadFailedBanner } from '@/components/common';
import { ConversationRow, conversationListStyles, ContactPicker, BroadcastComposer } from '@/components/messages';
import { colors, spacing, borderRadius, fonts } from '@/theme';
import type { ConversationSummary, MessageContact } from '@/types/messages';

interface Props { role: 'student' | 'mentor' | 'advisor' }
interface GroupChoice { id: string; name: string; isArchived?: boolean }

export function MessagesScreen({ role }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const refreshUnread = useMessageStore((s) => s.refreshUnread);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [groups, setGroups] = useState<GroupChoice[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'contact' | 'case' | 'broadcast'>('contact');
  // The broadcast selection lives here, not in the picker, so it survives a
  // reload of the contact list and the hop to the composer.
  const [recipients, setRecipients] = useState<string[]>([]);
  const [composer, setComposer] = useState(false);
  const [sending, setSending] = useState(false);
  const [contacts, setContacts] = useState<MessageContact[] | null>(null);
  const [contactsFailed, setContactsFailed] = useState(false);
  const request = useRef(0);
  const pickerReq = useRef(0);
  const { status: closure } = useClosureStatus(role === 'student' ? user?.id : null, role === 'student' ? groupId : null);

  // Which group a NEW conversation is opened in. Student: their active
  // group. Advisor: the selected chip. Mentor: the group of the student they
  // pick -- resolved in the picker (see openWith) because a mentor's
  // students may sit in different groups.
  const loadGroups = useCallback(async () => {
    if (!user) return;
    try {
      if (role === 'advisor') {
        const list = await groupService.listMyGroups(user.id);
        const choices = list.map((g) => ({ id: g.id, name: g.name, isArchived: g.isArchived }));
        setGroups(choices);
        setGroupId((cur) => (cur && choices.some((g) => g.id === cur) ? cur : (choices.find((g) => !g.isArchived) ?? choices[0])?.id ?? null));
      } else if (role === 'student') {
        const g = await groupService.getMyGroup(user.id);
        setGroups(g ? [{ id: g.id, name: g.name }] : []);
        setGroupId(g?.id ?? null);
      }
    } catch (err) {
      console.error('Messages groups load error:', err);
      setLoadFailed(true);
    }
  }, [user, role]);

  const load = useCallback(async () => {
    const req = ++request.current;
    setLoadFailed(false);
    try {
      // The list is always ALL of my conversations; the advisor's chip only
      // decides where a new one is opened.
      const list = await messageService.listConversations();
      if (req !== request.current) return;
      setItems(list);
      void refreshUnread();
    } catch (err) {
      if (req !== request.current) return;
      console.error('Messages load error:', err);
      setLoadFailed(true);
    } finally {
      if (req === request.current) setLoading(false);
    }
  }, [refreshUnread]);

  useFocusEffect(useCallback(() => { loadGroups(); load(); }, [loadGroups, load]));

  const onRefresh = useCallback(async () => { setRefreshing(true); await loadGroups(); await load(); setRefreshing(false); }, [loadGroups, load]);

  async function openPicker(mode: 'contact' | 'broadcast' = 'contact') {
    const req = ++pickerReq.current;
    setPicker(true);
    setPickerMode(mode);
    if (mode === 'broadcast') setRecipients([]);
    setContacts(null);
    setContactsFailed(false);
    try {
      if (role === 'mentor') {
        // A mentor's contacts are their linked students, each in their own
        // group. list_message_contacts is per group, so this goes through
        // its own RPC instead -- a mentor cannot read group_memberships
        // directly, so this cannot be resolved client-side.
        const students = await messageService.listMentorContacts();
        if (req !== pickerReq.current) return;
        setContacts(students);
      } else if (groupId) {
        const list = await messageService.listContacts(groupId);
        if (req !== pickerReq.current) return;
        // A broadcast resolves each recipient's group from their own student
        // membership, so a mentor in the list could only ever fail with
        // NOT_IN_GROUP. Offer the people who can actually receive it.
        setContacts(mode === 'broadcast' ? list.filter((c) => c.role === 'student') : list);
      } else {
        setContacts([]);
      }
    } catch (err) {
      if (req !== pickerReq.current) return;
      console.warn('Contacts load failed:', err instanceof Error ? err.message : err);
      setContacts([]);
      setContactsFailed(true);
    }
  }

  async function openCasePicker() {
    if (!groupId) return;
    const req = ++pickerReq.current;
    setPicker(true);
    setPickerMode('case');
    setContacts(null);
    setContactsFailed(false);
    try {
      const list = await messageService.listCaseCandidates(groupId);
      if (req !== pickerReq.current) return;
      setContacts(list);
    } catch (err) {
      if (req !== pickerReq.current) return;
      console.warn('Case candidates load failed:', err instanceof Error ? err.message : err);
      setContacts([]);
      setContactsFailed(true);
    }
  }

  function retryPicker() {
    if (pickerMode === 'case') void openCasePicker(); else void openPicker(pickerMode === 'broadcast' ? 'broadcast' : 'contact');
  }

  async function openWith(contact: MessageContact & { groupId?: string }) {
    if (pickerMode === 'broadcast') {
      setRecipients((cur) => toggleRecipient(cur, contact.id));
      return;
    }
    if (pickerMode === 'case') {
      if (!groupId) return;
      try {
        const id = await messageService.openCase(groupId, contact.id);
        setPicker(false);
        router.push({ pathname: `/(${role})/conversation`, params: { id } } as never);
      } catch (err) {
        const { key } = mapRpcError(err instanceof Error ? err.message : '');
        Alert.alert(t('common.error'), t(key));
      }
      return;
    }
    const gid = contact.groupId ?? groupId;
    if (!gid) return;
    try {
      const id = await messageService.openConversation(gid, contact.id);
      setPicker(false);
      router.push({ pathname: `/(${role})/conversation`, params: { id } } as never);
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    }
  }

  async function sendBroadcast(body: string) {
    const problem = broadcastFormError(recipients, body);
    if (problem) { Alert.alert(t('common.error'), t(problem)); return; }
    setSending(true);
    try {
      const result = await messageService.broadcast(recipients, body);
      const { key, params } = broadcastSummary(result);
      setComposer(false);
      setRecipients([]);
      showToast(t(key, params));
      await load();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSending(false);
    }
  }

  if (!user) return null;
  return (
    <SafeAreaView style={styles.safe}>
      {/* The title keeps its own line: with three actions (new message, to
          several, new case) a single row pushed the last one off screen. */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('messages.title', 'Messages')}</Text>
      </View>
      <View style={styles.actionRow}>
        {!closure?.closed && (
          <TouchableOpacity style={styles.newBtn} onPress={() => openPicker()} activeOpacity={0.7} accessibilityRole="button">
            <Ionicons name="create-outline" size={18} color={colors.ink} />
            <Text style={styles.newText}>{t('messages.newMessage', 'New message')}</Text>
          </TouchableOpacity>
        )}
        {(role === 'advisor' || role === 'mentor') && (
          <TouchableOpacity style={styles.newBtn} onPress={() => openPicker('broadcast')} activeOpacity={0.7} accessibilityRole="button">
            <Ionicons name="megaphone-outline" size={18} color={colors.ink} />
            <Text style={styles.newText}>{t('messages.broadcast', 'To several')}</Text>
          </TouchableOpacity>
        )}
        {role === 'advisor' && (
          <TouchableOpacity style={styles.newBtn} onPress={openCasePicker} activeOpacity={0.7} disabled={!groupId} accessibilityRole="button">
            <Ionicons name="people-outline" size={18} color={groupId ? colors.ink : colors.textDisabled} />
            <Text style={[styles.newText, !groupId && { color: colors.textDisabled }]}>{t('messages.newCase', 'New case')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ConversationRow item={item} me={user.id} locale={i18n.language} onPress={() => router.push({ pathname: `/(${role})/conversation`, params: { id: item.id } } as never)} />}
        ListHeaderComponent={
          <View>
            {loadFailed && <LoadFailedBanner onRetry={() => { loadGroups(); load(); }} />}
            {role === 'student' && (
              <ClosureBanner status={closure} onReport={() => router.push({ pathname: '/(student)/internship-report', params: { studentId: user.id, groupId: groupId ?? '' } })} />
            )}
            <Text style={conversationListStyles.note}>{t('messages.lifetimeNote', 'Messages are deleted when the group is archived or when someone leaves it.')}</Text>
            {role === 'advisor' && groups.length > 1 && (
              <View style={styles.chipRow}>
                {groups.map((g) => (
                  <TouchableOpacity key={g.id} style={[styles.chip, g.id === groupId && styles.chipActive, g.isArchived && { opacity: 0.6 }]} onPress={() => setGroupId(g.id)} activeOpacity={0.7}>
                    <Text style={[styles.chipText, g.id === groupId && styles.chipTextActive]} numberOfLines={1}>{g.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} /> : loadFailed ? null : (
          <View style={conversationListStyles.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color={colors.textDisabled} />
            <Text style={conversationListStyles.emptyText}>{t('messages.empty', 'No messages yet.')}</Text>
          </View>
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      />
      <ContactPicker
        visible={picker}
        contacts={contacts}
        failed={contactsFailed}
        onPick={openWith}
        onClose={() => { pickerReq.current++; setPicker(false); }}
        onRetry={retryPicker}
        title={pickerMode === 'case' ? t('messages.pickCaseStudent', 'Open a case for which student?')
          : pickerMode === 'broadcast' ? t('messages.pickRecipients', 'Who gets this message?') : undefined}
        hint={pickerMode === 'case' ? t('messages.caseHint', 'A case is a thread between you, the student and their mentor.')
          : pickerMode === 'broadcast' ? t('messages.broadcastPickHint', 'Everyone you pick gets the same message, privately.') : undefined}
        multi={pickerMode === 'broadcast'
          ? { selected: recipients, onSubmit: () => { setPicker(false); setComposer(true); } }
          : undefined}
      />
      <BroadcastComposer
        visible={composer}
        count={recipients.length}
        busy={sending}
        onSend={sendBroadcast}
        onClose={() => { if (!sending) { setComposer(false); setRecipients([]); } }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { fontSize: 26, fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink },
  // Wraps rather than overflowing: an advisor has three actions here, and a
  // long locale (or a large font setting) needs the second line.
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.lg, rowGap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  newText: { fontSize: 14, fontWeight: '500', fontFamily: fonts.medium, color: colors.ink },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, minHeight: 40, justifyContent: 'center', borderRadius: borderRadius.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.divider },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13, fontFamily: fonts.regular, color: colors.text, maxWidth: 160 },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600', fontFamily: fonts.semibold },
});
