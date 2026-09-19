import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { taskContent } from '@/utils/taskContent';
import { competencyContent } from '@/utils/competencyContent';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useMentorReviewStore } from '@/store/mentorReviewStore';
import { mentorService } from '@/services/mentor';
import { mentorReviewService } from '@/services/mentorReviews';
import { filterReviews } from '@/utils/mentorReviews';
import { taskDueDate } from '@/utils/studentTasks';
import { LoadFailedBanner, Stamp } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { ReviewHeader, ReviewIdentity } from '@/components/mentor/ReviewUI';
import { colors, fonts } from '@/theme';

type DashboardStats = Awaited<ReturnType<typeof mentorService.getDashboardStats>>;
type ReviewQueue = Awaited<ReturnType<typeof mentorReviewService.list>>;

export default function MentorDashboard() {
  const user = useAuthStore(s => s.user);
  return <Dashboard key={user?.id || 'signed-out'} userId={user?.id} name={user?.firstName || ''} />;
}

function Dashboard({ userId, name }: { userId?: string; name: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [statsFailed, setStatsFailed] = useState(false);
  const [queueFailed, setQueueFailed] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setStatsLoading(true);
    setQueueLoading(true);
    setStatsFailed(false);
    setQueueFailed(false);
    // Do not leave a previously reviewed submission actionable while refreshing.
    setQueue(null);
    const current = () => request === generation.current && useAuthStore.getState().user?.id === userId;
    if (!userId) {
      setStatsLoading(false);
      setQueueLoading(false);
      return;
    }
    // Independent sections: a statistics failure must not hide the review queue.
    await Promise.all([
      mentorService.getDashboardStats(userId).then(result => {
        if (current()) setStats(result);
      }).catch(() => {
        if (current()) { setStats(null); setStatsFailed(true); }
      }).finally(() => { if (current()) setStatsLoading(false); }),
      mentorReviewService.list().then(result => {
        if (!current()) return;
        setQueue(result);
        useMentorReviewStore.getState().setCount(userId, result.items.length);
      }).catch(() => {
        if (current()) {
          setQueueFailed(true);
          useMentorReviewStore.getState().invalidate(userId);
        }
      }).finally(() => { if (current()) setQueueLoading(false); }),
    ]);
  }, [userId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; };
  }, [load]));

  const next = queue ? filterReviews(queue.items, queue.names, '', 'oldest', i18n.language)[0] : undefined;
  const waiting = queue?.items.length ?? 0;
  const statusLine = [
    stats?.assignedCount != null && t('mentorHome.studentsCount', '{{count}} students', { count: stats.assignedCount }),
    queue && !queueLoading && t('mentorHome.waiting', { count: waiting }),
  ].filter(Boolean).join(' · ') || t('mentorHome.intro');
  const competency = next?.assignment.competencyName
    ? `${competencyContent(next.assignment.competencyName, i18n.language)}${next.assignment.level ? ' · L' + next.assignment.level : ''}` : undefined;
  const due = next ? taskDueDate(next.assignment.dueDate, i18n.language) : undefined;
  const facts = [
    competency && { label: t('dash.competency', 'Competency'), value: competency },
    due && { label: t('student.taskDueDate'), value: due },
  ].filter((f): f is { label: string; value: string } => !!f);
  const rate = stats?.approvalRate == null ? null
    : new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(stats.approvalRate / 100);
  const weekLine = stats
    ? `${t('mentorHome.reviewedWeek')}: ${stats.reviewedThisWeek ?? '—'} · ${rate == null ? t('mentorHome.noDecisions') : t('mentorHome.approvalRate') + ' ' + rate}`
    : null;
  const rows: { key: string; title: string; hint?: string; href: Href }[] = [
    { key: 'days', title: t('days.staffTitle'), hint: t('days.linkHint'), href: '/(mentor)/internship-days' },
    { key: 'history', title: t('mentorHome.history'), hint: t('mentorHome.historyHint'), href: '/(mentor)/feedback' },
  ];
  const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.rule };

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={statsLoading || queueLoading} onRefresh={load} tintColor={colors.primaryDark} />}>
      <ReviewHeader title={name ? t('mentorHome.greeting', { name }) : t('mentorHome.welcome')} />
      <Text style={[ui.secondary, { marginTop: -12 }]}>{statusLine}</Text>

      <View style={[ui.card, ui.featured]}>
        {queueLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')} color={colors.primaryDark} /> :
          queueFailed ? <LoadFailedBanner onRetry={load} /> :
          next ? <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 24 }}>
              <Text accessibilityRole="header" style={ui.section}>{t('mentorHome.nextReview')}</Text>
              <Stamp kind="pending" />
            </View>
            <ReviewIdentity name={queue!.names[next.studentId] || ''} submittedAt={next.submittedAt} />
            <Text style={ui.cardTitle}>{taskContent(next.assignment.title, i18n.language)}</Text>
            {facts.length > 0 && <View style={{ gap: 6 }}>
              {facts.map((f) => <View key={f.label} style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={[ui.secondary, { width: 96 }]}>{f.label}</Text>
                <Text style={[ui.body, { flex: 1, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] }]}>{f.value}</Text>
              </View>)}
            </View>}
            <View style={{ borderTopWidth: 1, borderColor: colors.rule }} />
            <Pressable accessibilityRole="button" style={ui.primary}
              accessibilityLabel={t('mentorFlow.inspect') + ': ' + taskContent(next.assignment.title, i18n.language)}
              onPress={() => router.push({ pathname: '/(mentor)/review-detail', params: { id: next.id, studentId: '', assignmentId: '' } })}>
              <Text style={ui.primaryText}>{t('mentorFlow.inspect')}</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </Pressable>
          </> : <>
            <Text accessibilityRole="header" style={ui.section}>{t('mentor.noPendingReviews')}</Text>
            <Text style={ui.secondary}>{t('mentorHome.emptyHint')}</Text>
          </>}
      </View>
      {waiting > 1 && <Pressable accessibilityRole="button" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: -8 }}
        onPress={() => router.push({ pathname: '/(mentor)/pending-reviews', params: { assignmentId: '', studentId: '' } })}>
        <Text style={{ fontSize: 14, color: colors.ink, fontFamily: fonts.medium }}>{t('mentorHome.allPending', { count: waiting })}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.ink} />
      </Pressable>}

      <View style={{ borderTopWidth: 1, borderColor: colors.rule }}>
        {statsFailed && <LoadFailedBanner onRetry={load} />}
        {statsLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')} color={colors.primaryDark} style={{ paddingVertical: 12 }} /> :
          !!weekLine && <View style={rowStyle} accessible accessibilityLabel={weekLine}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ui.label}>{t('mentorHome.summary')}</Text>
              <Text style={ui.secondary}>{weekLine}</Text>
            </View>
          </View>}
        {rows.map((row) => <Pressable key={row.key} accessibilityRole="button" style={rowStyle} onPress={() => router.push(row.href)}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ui.label}>{row.title}</Text>
            {!!row.hint && <Text style={ui.secondary}>{row.hint}</Text>}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink} />
        </Pressable>)}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
