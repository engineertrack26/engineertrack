import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorDashboardViewService } from '@/services/advisorDashboardView';
import { notificationService } from '@/services/notifications';
import { LoadFailedBanner } from '@/components/common';
import { AdvisorBell, groupStyles } from '@/components/advisor/GroupUI';
import { ui } from '@/components/common/workflowStyles';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { groupCenterRoute } from '@/utils/advisorGroups';
import { colors, fonts } from '@/theme';
import { showToast } from '@/components/common/Toast';

type DashboardData = Awaited<ReturnType<typeof advisorDashboardViewService.load>>;

export default function AdvisorDashboard() {
  const userId = useAuthStore((s) => s.user?.id);
  return userId ? <DashboardContent key={userId} advisorId={userId} /> : null;
}

function DashboardContent({ advisorId }: { advisorId: string }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
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
      showToast(t('advisorHome.reminderSent', { name }));
    } catch {
      if (useAuthStore.getState().user?.id === advisorId)
        Alert.alert(t('common.error'), t('advisorHome.reminderFailed'));
    } finally { locks.current.delete(studentId); setSending(new Set(locks.current)); }
  }

  const statusLine = [
    groups && t('advisorHome.groupCount', '{{count}} groups', { count: groups.length }),
    stats && t('advisorGroups.memberCount', { count: stats.assignedCount }),
    progressKnown && t('advisorHome.avgProgress', 'progress {{percent}}%', { percent: stats.avgCompletion }),
  ].filter(Boolean).join(' · ') || t('advisorHome.title');
  const tools: { key: string; title: string; hint: string; onPress: () => void }[] = [
    { key: 'students', title: t('advisorGroups.viewStudents'), hint: t('advisorGroups.membersHint'), onPress: () => router.push('/(advisor)/student-monitor') },
    { key: 'reports', title: t('advisorGroups.reportsTitle'), hint: t('advisorHome.reportsHint'), onPress: () => router.push('/(advisor)/reports') },
    { key: 'days', title: t('days.staffTitle'), hint: t('days.linkHint'), onPress: () => router.push('/(advisor)/internship-days') },
  ];

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} colors={[colors.primaryDark]}
        onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <View style={ui.header}>
        <Text style={[ui.title, { flex: 1 }]} accessibilityRole="header">{t('advisorHome.greeting', { name: user?.firstName || '' })}</Text>
        <AdvisorBell />
      </View>
      <Text style={[ui.secondary, { marginTop: -12 }]} accessibilityLiveRegion="polite">{statusLine}</Text>
      {progressPartial && <Text style={ui.secondary}>{t('advisorHome.partialProgress')}</Text>}

      {loading && !data ? <ActivityIndicator size="large" color={colors.primaryDark} /> : <>
        {partial && <LoadFailedBanner onRetry={() => void load()} />}

        <View style={[ui.card, ui.featured]}>
          <Text style={ui.section} accessibilityRole="header">{t('advisorHome.followUp')}{followUp ? ' (' + followUp.length + ')' : ''}</Text>
          {followUp === null ? <Text style={ui.body}>{t('advisorHome.unavailable')}</Text> :
            followUp.length === 0 ? <Text style={ui.body}>{t('advisorHome.allClear')}</Text> :
            <View>
              {visibleFollowUp?.map((student) => {
                const name = [student.firstName, student.lastName].filter(Boolean).join(' ');
                const busy = sending.has(student.id);
                const done = sent.has(student.id);
                return <View key={student.id} style={styles.followRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={ui.label}>{name}</Text>
                    <Text style={ui.secondary}>{student.daysSinceLastSubmission === null
                      ? t('advisor.noSubmissionsYet') : t('advisor.daysSinceLastSubmission', { count: student.daysSinceLastSubmission })}</Text>
                  </View>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('advisorHome.reminderFor', { name })}
                    accessibilityState={{ disabled: busy || done, busy }} style={[groupStyles.outline, styles.remind, done && { borderColor: colors.rule }]}
                    disabled={busy || done} onPress={() => confirmReminder(student.id, name)}>
                    {busy ? <ActivityIndicator color={colors.primaryDark} /> :
                      <Text style={[groupStyles.linkText, { fontSize: 14 }, done && { color: colors.textSecondary }]}>{t(done ? 'advisorHome.sent' : 'advisorHome.remind')}</Text>}
                  </TouchableOpacity>
                </View>;
              })}
              {!!followUp && followUp.length > 3 && <TouchableOpacity accessibilityRole="button"
                accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}>
                <Text style={[ui.link, { fontSize: 14, paddingBottom: 0 }]}>{t(expanded ? 'advisorHome.showLess' : 'advisorHome.showAll')}</Text>
              </TouchableOpacity>}
            </View>}
          <Text style={ui.secondary}>{t('advisorHome.followUpHint')}</Text>
        </View>

        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 4 }}>
            <Text style={ui.section} accessibilityRole="header">{t('advisorHome.activeGroups')}</Text>
            <Pressable accessibilityRole="button" onPress={openGroups} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={{ fontSize: 14, color: colors.ink, fontFamily: fonts.medium }}>{t('advisorHome.openGroups')}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.ink} />
            </Pressable>
          </View>
          <View style={{ borderTopWidth: 1, borderColor: colors.rule }}>
            {groups === null ? <Text style={[ui.body, { paddingVertical: 12 }]}>{t('advisorHome.unavailable')}</Text> :
              groups.length === 0 ? <View style={{ paddingVertical: 12, gap: 4 }}>
                <Text style={ui.label}>{t('advisorGroups.noActive')}</Text>
                <Text style={ui.secondary}>{t('advisorGroups.createHint')}</Text>
              </View> : groups.slice(0, 3).map((group) =>
                <Pressable key={group.id} accessibilityRole="button" style={styles.row} onPress={() => router.push(groupCenterRoute(group.id))}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={ui.label}>{group.name}</Text>
                    <Text style={ui.secondary}>{[group.term, counts ? t('advisorGroups.memberCount', { count: counts[group.id] ?? 0 })
                      : t('advisorGroups.countUnavailable')].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.ink} />
                </Pressable>)}
          </View>
        </View>

        <View style={{ borderTopWidth: 1, borderColor: colors.rule }}>
          {tools.map((tool) => <Pressable key={tool.key} accessibilityRole="button" style={styles.row} onPress={tool.onPress}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ui.label}>{tool.title}</Text>
              <Text style={ui.secondary}>{tool.hint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink} />
          </Pressable>)}
        </View>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.rule },
  followRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.divider },
  remind: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12 },
});
