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
import { groupCenterRoute, groupWorkspaceRoute } from '@/utils/advisorGroups';
import { mapMonitorStudent, filterMonitorStudents, type StudentMonitorItem } from '@/utils/advisorStudentMonitor';
import { mapRpcError } from '@/utils/rpcErrors';
import { BackButton, LoadFailedBanner } from '@/components/common';
import { AdvisorBell, groupStyles } from '@/components/advisor/GroupUI';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';
import type { GroupMember, InternshipGroup } from '@/types/group';

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
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#eaf1fb', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 18, fontWeight: '700', color: colors.primaryDark, textTransform: 'uppercase' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.divider },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primaryDark },
  period: { padding: 14, gap: 8, backgroundColor: colors.background, borderRadius: 12 },
  remove: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  removeText: { color: '#a52929', fontSize: 15, fontWeight: '600' },
});
