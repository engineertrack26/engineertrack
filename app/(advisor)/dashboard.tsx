import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorDashboardViewService } from '@/services/advisorDashboardView';
import { notificationService } from '@/services/notifications';
import { LoadFailedBanner } from '@/components/common';
import { AdvisorBell, GroupRow, groupStyles } from '@/components/advisor/GroupUI';
import { InternshipDaysLink } from '@/components/internship/InternshipDaysLink';
import { ui } from '@/components/common/workflowStyles';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { groupCenterRoute } from '@/utils/advisorGroups';
import { colors } from '@/theme';

type DashboardData = Awaited<ReturnType<typeof advisorDashboardViewService.load>>;

export default function AdvisorDashboard() {
  const userId = useAuthStore((s) => s.user?.id);
  return userId ? <DashboardContent key={userId} advisorId={userId} /> : null;
}

function DashboardContent({ advisorId }: { advisorId: string }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 370 || fontScale > 1.25;
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const locks = useRef(new Set<string>());
  const delivered = useRef(new Set<string>());
  const sequence = useRef(0);
  const active = useRef(false);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result = await advisorDashboardViewService.load(advisorId);
      if (request === sequence.current && useAuthStore.getState().user?.id === advisorId) setData(result);
    } finally {
      if (request === sequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [advisorId]);
  useFocusEffect(useCallback(() => {
    active.current = true; setFocused(true); void load();
    return () => { active.current = false; sequence.current += 1; setFocused(false); };
  }, [load]));
  useRealtimeSubscription({
    table: 'assignment_submissions', event: '*', enabled: focused,
    onPayload: () => { if (active.current) void load(); },
  });

  const stats = data?.stats.status === 'fulfilled' ? data.stats.value : null;
  const groups = data?.groups.status === 'fulfilled' ? data.groups.value.filter((g) => !g.isArchived) : null;
  const counts = data?.counts.status === 'fulfilled' ? data.counts.value : null;
  const followUp = data?.followUp.status === 'fulfilled' ? data.followUp.value : null;
  const partial = !!data && Object.values(data).some((result) => result.status === 'rejected');
  const progressPartial = !!stats && stats.progressResolvedCount < stats.assignedCount;
  const progressKnown = !!stats && stats.assignedCount > 0 && stats.progressResolvedCount > 0;
  const openGroups = () => router.push({ pathname: '/(advisor)/groups', params: { groupId: '' } });
  const visibleFollowUp = expanded ? followUp : followUp?.slice(0, 3);

  function confirmReminder(studentId: string, name: string) {
    if (locks.current.has(studentId) || delivered.current.has(studentId)) return;
    Alert.alert(t('advisorHome.remind'), t('advisorHome.confirmReminder', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('advisorHome.remind'), onPress: () => { void sendReminder(studentId, name); } },
    ]);
  }
  async function sendReminder(studentId: string, name: string) {
    if (locks.current.has(studentId) || delivered.current.has(studentId) ||
        useAuthStore.getState().user?.id !== advisorId || !active.current) return;
    locks.current.add(studentId); setSending(new Set(locks.current));
    try {
      const advisor = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
      await notificationService.create(studentId, t('advisor.reminderTitle'),
        t('advisor.reminderBody', { advisor }), 'general', {});
      delivered.current.add(studentId);
      if (useAuthStore.getState().user?.id !== advisorId) return;
      setSent(new Set(delivered.current));
      Alert.alert(t('common.done'), t('advisorHome.reminderSent', { name }));
    } catch {
      if (useAuthStore.getState().user?.id === advisorId)
        Alert.alert(t('common.error'), t('advisorHome.reminderFailed'));
    } finally { locks.current.delete(studentId); setSending(new Set(locks.current)); }
  }

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} colors={[colors.primaryDark]}
        onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <View style={ui.header}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={ui.secondary}>{t('advisorHome.greeting', { name: user?.firstName || '' })}</Text>
          <Text style={ui.title} accessibilityRole="header">{t('advisorHome.title')}</Text>
        </View>
        <AdvisorBell />
      </View>
      <View style={styles.hero}>
        <InternshipDaysLink role="advisor" />
        <View style={styles.heroIcon}><Ionicons name="school-outline" size={28} color={colors.primaryDark} /></View>
        <Text style={ui.cardTitle}>{t('advisorHome.heroTitle')}</Text>
        <Text style={ui.body}>{t('advisorHome.heroBody')}</Text>
        <TouchableOpacity accessibilityRole="button" style={ui.primary} onPress={openGroups}>
          <Text style={ui.primaryText}>{t('advisorHome.openGroups')}</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      {loading && !data ? <ActivityIndicator size="large" color={colors.primaryDark} /> : <>
        {partial && <LoadFailedBanner onRetry={() => void load()} />}
        <View style={[styles.metrics, stacked && { flexDirection: 'column' }]}>
          <Metric label={t('advisorHome.activeGroups')} value={groups?.length} />
          <Metric label={t('advisorHome.activeStudents')} value={stats?.assignedCount} />
        </View>
        <View style={ui.card}>
          <View style={ui.header}>
            <Ionicons name="trending-up-outline" size={24} color={colors.primaryDark} />
            <Text style={[ui.label, { flex: 1 }]}>{t('advisorHome.progress')}</Text>
            <Text style={styles.percent}>{progressKnown ? stats.avgCompletion + '%' : '—'}</Text>
          </View>
          <Text style={ui.secondary}>{t(progressPartial ? 'advisorHome.partialProgress' : 'advisorHome.progressHint')}</Text>
          {progressKnown && <View style={styles.track} accessible accessibilityRole="progressbar"
            accessibilityLabel={t('advisorHome.progress')} accessibilityValue={{ min: 0, max: 100, now: stats.avgCompletion }}>
            <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, stats.avgCompletion))}%` }]} />
          </View>}
        </View>

        <View style={{ gap: 12 }}>
          <Text style={ui.section} accessibilityRole="header">{t('advisorHome.followUp')}{followUp ? ' (' + followUp.length + ')' : ''}</Text>
          <Text style={ui.secondary}>{t('advisorHome.followUpHint')}</Text>
          {followUp === null ? <Text style={ui.body}>{t('advisorHome.unavailable')}</Text> :
            followUp.length === 0 ? <View style={styles.calm}>
              <Ionicons name="checkmark-circle-outline" size={24} color={colors.stamp} />
              <Text style={[ui.body, { flex: 1 }]}>{t('advisorHome.allClear')}</Text>
            </View> : visibleFollowUp?.map((student) => {
              const name = [student.firstName, student.lastName].filter(Boolean).join(' ');
              const busy = sending.has(student.id);
              const done = sent.has(student.id);
              return <View style={[ui.card, styles.followCard]} key={student.id}>
                <Text style={ui.label}>{name}</Text>
                <Text style={ui.secondary}>{student.daysSinceLastSubmission === null
                  ? t('advisor.noSubmissionsYet') : t('advisor.daysSinceLastSubmission', { count: student.daysSinceLastSubmission })}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('advisorHome.reminderFor', { name })}
                  accessibilityState={{ disabled: busy || done, busy }} style={groupStyles.outline}
                  disabled={busy || done} onPress={() => confirmReminder(student.id, name)}>
                  {busy ? <ActivityIndicator color={colors.primaryDark} /> :
                    <Text style={groupStyles.linkText}>{t(done ? 'advisorHome.sent' : 'advisorHome.remind')}</Text>}
                </TouchableOpacity>
              </View>;
            })}
          {!!followUp && followUp.length > 3 && <TouchableOpacity accessibilityRole="button"
            accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}>
            <Text style={ui.link}>{t(expanded ? 'advisorHome.showLess' : 'advisorHome.showAll')}</Text>
          </TouchableOpacity>}
        </View>

        <Text style={ui.section} accessibilityRole="header">{t('advisorHome.activeGroups')}</Text>
        {groups === null ? <Text style={ui.body}>{t('advisorHome.unavailable')}</Text> :
          groups.length === 0 ? <View style={ui.card}>
            <Text style={ui.label}>{t('advisorGroups.noActive')}</Text>
            <Text style={ui.secondary}>{t('advisorGroups.createHint')}</Text>
          </View> : groups.slice(0, 3).map((group) =>
            <GroupRow key={group.id} title={group.name} icon="people-outline"
              detail={[group.term, counts ? t('advisorGroups.memberCount', { count: counts[group.id] ?? 0 })
                : t('advisorGroups.countUnavailable')].filter(Boolean).join(' · ')}
              onPress={() => router.push(groupCenterRoute(group.id))} />)}
        <TouchableOpacity accessibilityRole="button" style={groupStyles.outline} onPress={openGroups}>
          <Text style={groupStyles.linkText}>{t('advisorHome.openGroups')}</Text>
        </TouchableOpacity>
        <Text style={ui.section} accessibilityRole="header">{t('advisorHome.tools')}</Text>
        <GroupRow title={t('advisorGroups.viewStudents')} detail={t('advisorGroups.membersHint')}
          icon="person-outline" onPress={() => router.push('/(advisor)/student-monitor')} />
        <GroupRow title={t('advisorGroups.reportsTitle')} detail={t('advisorHome.reportsHint')}
          icon="bar-chart-outline" onPress={() => router.push('/(advisor)/reports')} />
      </>}
    </ScrollView>
  </SafeAreaView>;
}

function Metric({ label, value }: { label: string; value?: number }) {
  const { t } = useTranslation();
  return <View style={[ui.card, { flex: 1 }]} accessible
    accessibilityLabel={label + ': ' + (value ?? t('advisorHome.unavailable'))}>
    <Text style={styles.metricValue}>{value ?? '—'}</Text><Text style={ui.secondary}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.paper, borderRadius: 6, padding: 20, gap: 14, borderWidth: 1.5, borderColor: colors.ink },
  heroIcon: { backgroundColor: colors.inkBg, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  metrics: { flexDirection: 'row', gap: 12 },
  metricValue: { fontSize: 30, fontWeight: '700', color: colors.text },
  percent: { fontSize: 22, fontWeight: '700', color: colors.primaryDark },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.primaryDark, borderRadius: 4 },
  calm: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.stampBg, borderRadius: 6, padding: 16 },
  followCard: { borderLeftWidth: 4, borderLeftColor: colors.warning },
});
