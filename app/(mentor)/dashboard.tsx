import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { taskContent } from '@/utils/taskContent';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useMentorReviewStore } from '@/store/mentorReviewStore';
import { mentorService } from '@/services/mentor';
import { mentorReviewService } from '@/services/mentorReviews';
import { filterReviews } from '@/utils/mentorReviews';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { ReviewHeader, ReviewIdentity } from '@/components/mentor/ReviewUI';
import { InternshipDaysLink } from '@/components/internship/InternshipDaysLink';
import { colors } from '@/theme';

type DashboardStats = Awaited<ReturnType<typeof mentorService.getDashboardStats>>;
type ReviewQueue = Awaited<ReturnType<typeof mentorReviewService.list>>;

export default function MentorDashboard() {
  const user = useAuthStore(s => s.user);
  return <Dashboard key={user?.id || 'signed-out'} userId={user?.id} name={user?.firstName || ''} />;
}

function Dashboard({ userId, name }: { userId?: string; name: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.3;
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
  const shortcuts: { title: string; hint: string; icon: keyof typeof Ionicons.glyphMap; href: Href }[] = [
    { title: t('mentorHome.history'), hint: t('mentorHome.historyHint'), icon: 'time-outline', href: '/(mentor)/feedback' },
    { title: t('mentorHome.students'), hint: t('mentorHome.studentsHint'), icon: 'people-outline', href: { pathname: '/(mentor)/student-list', params: { studentId: '' } } },
  ];
  const metrics = [
    { label: t('mentorHome.assigned'), value: stats?.assignedCount, icon: 'people-outline' as const },
    { label: t('mentorHome.reviewedWeek'), value: stats?.reviewedThisWeek, icon: 'checkmark-done-outline' as const },
  ];

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <View style={[ui.content, { paddingTop: 12, paddingBottom: 12 }]}><ReviewHeader brand /></View>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={statsLoading || queueLoading} onRefresh={load} tintColor={colors.primaryDark} />}>
      <InternshipDaysLink role="mentor" />
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={ui.title}>{name ? t('mentorHome.greeting', { name }) : t('mentorHome.welcome')}</Text>
        <Text style={ui.body}>{t('mentorHome.intro')}</Text>
      </View>

      <View style={[ui.card, ui.featured]}>
        {queueLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')} color={colors.primaryDark} /> :
          queueFailed ? <LoadFailedBanner onRetry={load} /> :
          next ? <>
            <Text style={[ui.badge, { color: colors.primaryDark, backgroundColor: '#eaf2fe' }]}>{t('mentorHome.waiting', { count: queue!.items.length })}</Text>
            <Text accessibilityRole="header" style={ui.section}>{t('mentorHome.nextReview')}</Text>
            <ReviewIdentity name={queue!.names[next.studentId] || ''} submittedAt={next.submittedAt} />
            <Text style={ui.cardTitle}>{taskContent(next.assignment.title, i18n.language)}</Text>
            <Text style={ui.secondary}>{t('mentorHome.oldestHint')}</Text>
            <Pressable accessibilityRole="button" style={ui.primary}
              accessibilityLabel={t('mentorFlow.inspect') + ': ' + taskContent(next.assignment.title, i18n.language)}
              onPress={() => router.push({ pathname: '/(mentor)/review-detail', params: { id: next.id, studentId: '', assignmentId: '' } })}>
              <Text style={ui.primaryText}>{t('mentorFlow.inspect')}</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </Pressable>
          </> : <>
            <Ionicons name="checkmark-circle-outline" size={32} color={colors.primaryDark} />
            <Text accessibilityRole="header" style={ui.section}>{t('mentor.noPendingReviews')}</Text>
            <Text style={ui.secondary}>{t('mentorHome.emptyHint')}</Text>
          </>}
      </View>
      <Pressable accessibilityRole="button" style={[ui.header, { minHeight: 48, justifyContent: 'center' }]}
        onPress={() => router.push({ pathname: '/(mentor)/pending-reviews', params: { assignmentId: '', studentId: '' } })}>
        <Text style={[ui.link, { flexShrink: 1 }]}>{queue && !queueLoading ? t('mentorHome.allPending', { count: queue.items.length }) : t('mentorHome.openQueue')}</Text>
        <Ionicons name="arrow-forward" size={20} color={colors.primaryDark} />
      </Pressable>

      <Text accessibilityRole="header" style={ui.section}>{t('mentorHome.summary')}</Text>
      {statsLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')} color={colors.primaryDark} /> :
        statsFailed ? <LoadFailedBanner onRetry={load} /> : <>
          <View style={{ flexDirection: compact ? 'column' : 'row', gap: 12 }}>
            {metrics.map(metric => <View key={metric.label} style={[ui.card, { flex: 1, padding: 16 }]}>
              <Ionicons name={metric.icon} size={24} color={colors.primaryDark} />
              <Text style={[ui.title, { fontSize: 28 }]}>{metric.value ?? '—'}</Text>
              <Text style={ui.secondary}>{metric.label}</Text>
            </View>)}
          </View>
          <View style={[ui.header, { flexWrap: 'wrap' }]}>
            <Text style={ui.label}>{t('mentorHome.approvalRate')}</Text>
            <Text style={ui.label}>{stats?.approvalRate == null ? '—' : new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(stats.approvalRate / 100)}</Text>
            <Text style={ui.secondary}>{t(stats?.approvalRate == null ? 'mentorHome.noDecisions' : 'mentorHome.approvalHint')}</Text>
          </View>
        </>}

      <Text accessibilityRole="header" style={ui.section}>{t('mentorHome.shortcuts')}</Text>
      <View style={[ui.card, { padding: 0, gap: 0 }]}>
        {shortcuts.map((shortcut, index) => <Pressable key={shortcut.title} accessibilityRole="button"
          onPress={() => router.push(shortcut.href)} style={({ pressed }) => [ui.header, {
            padding: 16, minHeight: 80, opacity: pressed ? 0.65 : 1,
            borderBottomWidth: index < shortcuts.length - 1 ? 1 : 0, borderBottomColor: colors.divider,
          }]}>
          <Ionicons name={shortcut.icon} size={24} color={colors.primaryDark} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={ui.label}>{shortcut.title}</Text>
            <Text style={ui.secondary}>{shortcut.hint}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </Pressable>)}
      </View>
      <View style={[ui.card, ui.header, { backgroundColor: '#eaf2fe' }]}>
        <Ionicons name="notifications-outline" size={24} color={colors.primaryDark} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={ui.label}>{t('mentorHome.bellTitle')}</Text>
          <Text style={ui.secondary}>{t('mentorHome.bellHint')}</Text>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
