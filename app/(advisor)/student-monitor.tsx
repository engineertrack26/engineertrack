import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity, Alert, TextInput } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { groupService } from '@/services/group';
import { messageService } from '@/services/messages';
import { closureService } from '@/services/closure';
import { groupCenterRoute, groupWorkspaceRoute } from '@/utils/advisorGroups';
import { mapMonitorStudent, filterMonitorStudents, type StudentMonitorItem } from '@/utils/advisorStudentMonitor';
import { mapRpcError } from '@/utils/rpcErrors';
import { pendingReviewsMessage } from '@/utils/closure';
import { BackButton, LoadFailedBanner, Stamp } from '@/components/common';
import { AdvisorBell, GroupModal, groupStyles } from '@/components/advisor/GroupUI';
import { ui } from '@/components/common/workflowStyles';
import { colors, fonts } from '@/theme';
import type { GroupMember, InternshipGroup } from '@/types/group';
import type { ClosureStatus } from '@/types/closure';

type MonitorRow = StudentMonitorItem & { member?: GroupMember; email?: string };

export default function StudentMonitorScreen() {
  const params = useLocalSearchParams<{ groupId?: string; fromGroup?: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  return userId ? <StudentMonitorContent key={userId + ':' + (params.groupId ?? '')}
    advisorId={userId} groupId={params.groupId} fromGroup={params.fromGroup} /> : null;
}

function StudentMonitorContent({ advisorId, groupId, fromGroup }: { advisorId: string; groupId?: string; fromGroup?: string }) {
  const { t, i18n } = useTranslation();
  const back = groupId ? fromGroup === '1' ? groupCenterRoute(groupId) :
    { pathname: '/(advisor)/groups' as const, params: { groupId: '' } } : '/(advisor)/dashboard' as const;
  const [group, setGroup] = useState<InternshipGroup | null>(null);
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const locks = useRef(new Set<string>());
  const confirming = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const [closures, setClosures] = useState<Map<string, ClosureStatus | null>>(new Map());
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const closingLocks = useRef(new Set<string>());
  const [reopenTarget, setReopenTarget] = useState<GroupMember | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenTouched, setReopenTouched] = useState(false);
  const [reopening, setReopening] = useState(false);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    const current = () => request === sequence.current && useAuthStore.getState().user?.id === advisorId;
    try {
      if (groupId) {
        const groups = await groupService.listMyGroups(advisorId);
        if (!current()) return;
        const owned = groups.find((g) => g.id === groupId);
        if (!owned) {
          setGroup(null); setRows([]); setUnavailable(true); setFailed(false); setLoaded(true);
          return;
        }
        setGroup(owned); setUnavailable(false);
        const members = await groupService.listMembers(groupId);
        if (!current()) return;
        setRows(members.map((member) => ({ ...mapMonitorStudent({
          id: member.id, profiles: { first_name: member.firstName, last_name: member.lastName },
          completionAvailable: false,
        }), member, email: member.email })));
        const settled = await Promise.allSettled(members.map((member) => closureService.status(member.id, groupId)));
        if (!current()) return;
        const map = new Map<string, ClosureStatus | null>();
        settled.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            map.set(members[i].id, result.value);
          } else {
            console.warn('Closure status load failed for', members[i].id, result.reason);
            map.set(members[i].id, null);
          }
        });
        setClosures(map);
      } else {
        const result = await advisorService.getDashboardStats(advisorId);
        if (!current()) return;
        setRows(result.students.map((row) => mapMonitorStudent(row)));
      }
      setLoaded(true); setFailed(false);
    } catch {
      if (current()) setFailed(true);
    } finally {
      if (current()) { setLoading(false); setRefreshing(false); }
    }
  }, [advisorId, groupId]);

  useFocusEffect(useCallback(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; sequence.current += 1; };
  }, [load]));

  async function confirmRemove(member: GroupMember) {
    if (locks.current.has(member.membershipId) || failed) return;
    if (confirming.current) return;
    confirming.current = true;
    try {
      const name = [member.firstName, member.lastName].filter(Boolean).join(' ');
      const n = groupId ? await messageService.countDeletable(groupId, member.id).catch(() => 0) : 0;
      const body = t('advisor.removeStudentConfirm', { name })
        + (n > 0 ? '\n\n' + t('messages.deleteWarning', { count: n, defaultValue_one: '{{count}} conversation and its messages will be permanently deleted.', defaultValue_other: '{{count}} conversations and their messages will be permanently deleted.' }) : '');
      Alert.alert(t('advisor.removeStudent'), body, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('advisor.removeStudent'), style: 'destructive', onPress: () => { void remove(member); } },
      ]);
    } finally {
      confirming.current = false;
    }
  }
  async function remove(member: GroupMember) {
    if (!groupId || locks.current.has(member.membershipId) || !mounted.current ||
        useAuthStore.getState().user?.id !== advisorId) return;
    locks.current.add(member.membershipId); setRemoving(new Set(locks.current));
    try {
      await groupService.closeMembership(member.membershipId);
      if (!mounted.current || useAuthStore.getState().user?.id !== advisorId) return;
      // A failed refresh must not bring the removed membership back on screen.
      sequence.current += 1;
      setRows((previous) => previous.filter((row) => row.member?.membershipId !== member.membershipId));
      Alert.alert(t('common.done'), t('advisor.removeStudentDone'));
      await load();
    } catch (err) {
      if (mounted.current && useAuthStore.getState().user?.id === advisorId) {
        const { key } = mapRpcError(err instanceof Error ? err.message : '');
        Alert.alert(t('common.error'), t(key));
      }
    } finally {
      locks.current.delete(member.membershipId);
      if (mounted.current) setRemoving(new Set(locks.current));
    }
  }

  function confirmClose(member: GroupMember) {
    if (!groupId || closingLocks.current.has(member.id) || failed) return;
    Alert.alert(t('closure.closeConfirmTitle'), t('closure.closeConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('closure.close'), style: 'destructive', onPress: () => { void doClose(member); } },
    ]);
  }
  async function doClose(member: GroupMember) {
    if (!groupId || closingLocks.current.has(member.id) || !mounted.current ||
        useAuthStore.getState().user?.id !== advisorId) return;
    closingLocks.current.add(member.id); setClosing(new Set(closingLocks.current));
    try {
      await closureService.close(member.id, groupId);
      if (!mounted.current || useAuthStore.getState().user?.id !== advisorId) return;
      await load();
      Alert.alert(t('common.done'), t('closure.closedOn', { date: new Date().toLocaleDateString(i18n.language) }));
    } catch (err) {
      if (mounted.current && useAuthStore.getState().user?.id === advisorId) {
        const { key } = mapRpcError(err instanceof Error ? err.message : '');
        Alert.alert(t('common.error'), t(key));
      }
    } finally {
      closingLocks.current.delete(member.id);
      if (mounted.current) setClosing(new Set(closingLocks.current));
    }
  }

  function openReopen(member: GroupMember) {
    if (closingLocks.current.has(member.id)) return;
    setReopenTarget(member); setReopenReason(''); setReopenTouched(false);
  }
  function closeReopen() {
    if (reopening) return;
    setReopenTarget(null);
  }
  async function confirmReopen() {
    if (!reopenTarget || !groupId || reopening) return;
    const reason = reopenReason.trim();
    if (!reason) { setReopenTouched(true); return; }
    setReopening(true);
    try {
      await closureService.reopen(reopenTarget.id, groupId, reason);
      if (!mounted.current || useAuthStore.getState().user?.id !== advisorId) return;
      setReopenTarget(null);
      await load();
      Alert.alert(t('common.done'), t('closure.reopened'));
    } catch (err) {
      if (mounted.current && useAuthStore.getState().user?.id === advisorId) {
        const { key } = mapRpcError(err instanceof Error ? err.message : '');
        Alert.alert(t('common.error'), t(key));
      }
    } finally {
      if (mounted.current) setReopening(false);
    }
  }

  function renderClosure(member: GroupMember) {
    const status = closures.get(member.id) ?? null;
    if (!status) return null;
    if (!status.closed) {
      const pending = status.pendingReviews > 0;
      const isClosing = closing.has(member.id);
      return <>
        <TouchableOpacity accessibilityRole="button" style={[styles.closeButton, (pending || isClosing) && { opacity: 0.5 }]}
          accessibilityLabel={t('closure.close') + ': ' + member.firstName + ' ' + member.lastName}
          accessibilityState={{ disabled: pending || isClosing, busy: isClosing }}
          disabled={pending || isClosing} onPress={() => confirmClose(member)}>
          {isClosing ? <ActivityIndicator color={colors.primaryDark} /> : <Text style={styles.closeButtonText}>{t('closure.close')}</Text>}
        </TouchableOpacity>
        {pending && <Text style={ui.secondary}>{pendingReviewsMessage(status.pendingReviews, t)}</Text>}
      </>;
    }
    return <View style={{ gap: 6 }}>
      <Stamp kind="closed" date={status.closedAt ? new Date(status.closedAt).toLocaleDateString(i18n.language) : undefined} />
      <TouchableOpacity accessibilityRole="button"
        onPress={() => router.push({ pathname: '/(advisor)/internship-report', params: { studentId: member.id, groupId: groupId! } })}>
        <Text style={ui.link}>{t('closure.viewReport')}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={() => openReopen(member)}>
        <Text style={ui.link}>{t('closure.reopen')}</Text>
      </TouchableOpacity>
    </View>;
  }

  const filtered = filterMonitorStudents(rows, search, i18n.language);
  const displayDate = (value: string) => new Date(value + 'T12:00:00').toLocaleDateString(i18n.language);
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <FlatList data={filtered} keyExtractor={(row) => row.member?.membershipId ?? row.id}
      contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }}
        colors={[colors.primaryDark]} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <View style={ui.header}><View style={{ flex: 1 }}><BackButton href={back} /></View><AdvisorBell /></View>
        <Text style={ui.title} accessibilityRole="header">{t('advisor.studentMonitor')}</Text>
        {!!group && <Text style={ui.label}>{group.name}{group.term ? ' · ' + group.term : ''}</Text>}
        <Text style={ui.secondary}>{t(groupId ? 'advisorMonitor.groupHint' : 'advisorMonitor.overviewHint')}</Text>
        {group?.isArchived && <Text style={ui.secondary}>{t('advisorGroups.archived')}</Text>}
        {failed && <LoadFailedBanner onRetry={() => void load()} />}
        {unavailable ? <Text style={ui.body}>{t('advisorGroups.unavailable')}</Text> : <>
          {loaded && <Text style={ui.label} accessibilityLiveRegion="polite">
            {search.trim() ? t('advisorMonitor.results', { shown: filtered.length, total: rows.length })
              : t('advisorGroups.memberCount', { count: rows.length })}
          </Text>}
          <TextInput style={ui.input} value={search} onChangeText={setSearch} autoCorrect={false}
            accessibilityLabel={t('advisorMonitor.search')} placeholder={t('advisorMonitor.search')}
            placeholderTextColor={colors.textSecondary} />
          {!!search && <TouchableOpacity accessibilityRole="button" onPress={() => setSearch('')}>
            <Text style={ui.link}>{t('advisorMonitor.clear')}</Text>
          </TouchableOpacity>}
          {group && <TouchableOpacity accessibilityRole="button" style={groupStyles.outline}
            onPress={() => router.push(groupWorkspaceRoute('reports', group.id))}>
            <Text style={groupStyles.linkText}>{t('advisorGroups.reportsTitle')}</Text>
          </TouchableOpacity>}
        </>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primaryDark} /> :
        !failed && !unavailable ? <View style={ui.card}>
          <Ionicons name="people-outline" size={32} color={colors.primaryDark} />
          <Text style={ui.section}>{t(search.trim() ? 'advisorGroups.noMatches' : 'advisor.noStudentsYet')}</Text>
          <Text style={ui.secondary}>{t(search.trim() ? 'advisorGroups.searchHint' : 'advisor.noStudentsYetHint')}</Text>
        </View> : null}
      renderItem={({ item }) => <View style={ui.card}>
        <View style={ui.header}>
          <View style={styles.avatar} accessible={false}><Text style={styles.initials}>
            {(item.firstName[0] || '') + (item.lastName[0] || '') || '?'}
          </Text></View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={ui.cardTitle}>{item.firstName} {item.lastName}</Text>
            {!!item.email && <Text selectable style={ui.secondary}>{item.email}</Text>}
            {!!item.companyName && <Text style={ui.secondary}>{item.companyName}</Text>}
          </View>
        </View>
        {item.member ? <>
          <Text style={ui.secondary}>{t('advisorMonitor.memberHint')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.remove}
            accessibilityLabel={t('advisor.removeStudent') + ': ' + item.firstName + ' ' + item.lastName}
            accessibilityState={{ disabled: removing.has(item.member.membershipId) || failed, busy: removing.has(item.member.membershipId) }}
            disabled={removing.has(item.member.membershipId) || failed} onPress={() => confirmRemove(item.member!)}>
            {removing.has(item.member.membershipId) ? <ActivityIndicator color={colors.error} /> :
              <Text style={styles.removeText}>{t('advisor.removeStudent')}</Text>}
          </TouchableOpacity>
          {!failed && renderClosure(item.member)}
        </> : <>
          <Text style={ui.label}>{t('advisorMonitor.progress')}{item.completionPct !== null ? ' · ' + item.completionPct + '%' : ''}</Text>
          {item.completionPct === null ? <Text style={ui.secondary}>{t('advisorMonitor.progressUnknown')}</Text> :
            <View style={styles.track} accessible accessibilityRole="progressbar"
              accessibilityLabel={t('advisorMonitor.progress')} accessibilityValue={{ min: 0, max: 100, now: item.completionPct }}>
              <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, item.completionPct))}%` }]} />
            </View>}
          <View style={styles.period}>
            <Text style={ui.label}>{t('advisorMonitor.period')}</Text>
            {item.daysCurrent !== null && item.daysTotal !== null ? <>
              <Text style={ui.body}>{displayDate(item.internshipStartDate!)} – {displayDate(item.internshipEndDate!)}</Text>
              <Text style={ui.secondary}>{t('advisor.internshipDay', { current: item.daysCurrent, total: item.daysTotal })}</Text>
            </> : <Text style={ui.secondary}>{t('advisorMonitor.periodUnknown')}</Text>}
          </View>
          <Text style={ui.secondary}>{t('advisorMonitor.activity', {
            xp: item.totalXp, level: item.currentLevel, weeks: item.currentStreak,
          })}</Text>
        </>}
      </View>} />
    {reopenTarget && <GroupModal title={t('closure.reopen')} onClose={closeReopen} busy={reopening}
      footer={<TouchableOpacity accessibilityRole="button" style={[ui.primary, reopening && { opacity: 0.6 }]}
        accessibilityState={{ disabled: reopening, busy: reopening }} disabled={reopening} onPress={() => void confirmReopen()}>
        {reopening ? <ActivityIndicator color="#fff" /> : <Text style={ui.primaryText}>{t('closure.reopenConfirm')}</Text>}
      </TouchableOpacity>}>
      <Text style={ui.body}>{t('closure.reopenReason')}</Text>
      <TextInput style={[ui.input, { minHeight: 100 }]} value={reopenReason} onChangeText={setReopenReason}
        multiline autoCorrect={false} accessibilityLabel={t('closure.reopenReason')}
        placeholder={t('closure.reopenReason')} placeholderTextColor={colors.textSecondary} />
      {reopenTouched && !reopenReason.trim() && <Text style={[ui.secondary, { color: colors.error }]}>{t('errors.reasonRequired')}</Text>}
    </GroupModal>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.inkBg, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 18, fontWeight: '600', fontFamily: fonts.semibold, color: colors.primaryDark, textTransform: 'uppercase' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.divider },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primaryDark },
  period: { padding: 14, gap: 8, backgroundColor: colors.background, borderRadius: 6 },
  remove: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  removeText: { color: colors.error, fontSize: 15, fontWeight: '600', fontFamily: fonts.semibold },
  closeButton: { minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', paddingVertical: 12 },
  closeButtonText: { color: colors.primaryDark, fontSize: 15, fontWeight: '600', fontFamily: fonts.semibold },
});
