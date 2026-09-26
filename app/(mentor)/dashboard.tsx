import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { mentorService } from '@/services/mentor';
import { internshipDayService } from '@/services/internshipDays';
import { dayWeek, needsAttendanceReview } from '@/utils/internshipDays';
import { internshipDateString } from '@/utils/internshipForm';
import { LoadFailedBanner, Stamp } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { ReviewHeader } from '@/components/mentor/ReviewUI';
import { colors } from '@/theme';

type DashboardStats = Awaited<ReturnType<typeof mentorService.getDashboardStats>>;

export default function MentorDashboard() {
  const user = useAuthStore(s => s.user);
  return <Dashboard key={user?.id || 'signed-out'} userId={user?.id} name={user?.firstName || ''} />;
}

function Dashboard({ userId, name }: { userId?: string; name: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [daysWaiting, setDaysWaiting] = useState<number | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [daysLoading, setDaysLoading] = useState(true);
  const [statsFailed, setStatsFailed] = useState(false);
  const [daysFailed, setDaysFailed] = useState(false);
  // Defaults to reachable: this only ever hides the "Review history" row, so
  // a slow or failed check must never hide a row that might in fact be real.
  const [historyExists, setHistoryExists] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setStatsLoading(true);
    setDaysLoading(true);
    setStatsFailed(false);
    setDaysFailed(false);
    const current = () => request === generation.current && useAuthStore.getState().user?.id === userId;
    if (!userId) {
      setStatsLoading(false);
      setDaysLoading(false);
      return;
    }
    // Independent sections: a statistics failure must not hide the attendance count.
    await Promise.all([
      mentorService.getDashboardStats(userId).then(result => {
        if (current()) setStats(result);
      }).catch(() => {
        if (current()) { setStats(null); setStatsFailed(true); }
      }).finally(() => { if (current()) setStatsLoading(false); }),
      (async () => {
        // Same call the internship-days screen uses to build its own queue
        // (src/components/internship/InternshipDaysScreen.tsx): one week per
        // student, batched 4 at a time.
        const today = internshipDateString(new Date());
        const from = dayWeek(today)[0];
        const people = await internshipDayService.people();
        let total = 0;
        for (let offset = 0; offset < people.length; offset += 4) {
          if (!current()) return;
          const counts = await Promise.all(people.slice(offset, offset + 4)
            .map(p => internshipDayService.week(p.id, from).then(days => days.filter(needsAttendanceReview).length)));
          total += counts.reduce((a, b) => a + b, 0);
        }
        if (current()) setDaysWaiting(total);
      })().catch(() => {
        if (current()) { setDaysWaiting(null); setDaysFailed(true); }
      }).finally(() => { if (current()) setDaysLoading(false); }),
      mentorService.hasFeedbackHistory(userId).then(result => {
        if (current()) setHistoryExists(result);
      }).catch(() => { if (current()) setHistoryExists(true); }),
    ]);
  }, [userId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; };
  }, [load]));

  const statusLine = stats?.assignedCount != null
    ? t('mentorHome.studentsCount', '{{count}} students', { count: stats.assignedCount }) : t('mentorHome.intro');
  const rows: { key: string; title: string; hint?: string; href: Href }[] = [
    { key: 'days', title: t('days.staffTitle'), hint: t('days.linkHint'), href: '/(mentor)/internship-days' },
    // Review history is real for a mentor with old decisions or legacy
    // feedback, but permanently empty for a new one -- it stays reachable,
    // just not featured until there is something behind it (I3).
    ...(historyExists ? [{ key: 'history', title: t('mentorHome.history'), hint: t('mentorHome.historyHint'), href: '/(mentor)/feedback' as Href }] : []),
  ];
  const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.rule };

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={statsLoading || daysLoading} onRefresh={load} tintColor={colors.primaryDark} />}>
      <ReviewHeader title={name ? t('mentorHome.greeting', { name }) : t('mentorHome.welcome')} />
      <Text style={[ui.secondary, { marginTop: -12 }]}>{statusLine}</Text>

      <View style={[ui.card, ui.featured]}>
        {/* Gated on both loads (I5): stats decides the assignedCount === 0
            branch below, so a still-loading stats fetch must not let the
            days-derived branches render first and then flip once stats
            resolves (a brand-new, unlinked mentor briefly saw "no pending
            attendance" before "link your first student"). */}
        {(daysLoading || statsLoading) ? <ActivityIndicator accessibilityLabel={t('common.loading')} color={colors.primaryDark} /> :
          daysFailed ? <LoadFailedBanner onRetry={load} /> :
          stats?.assignedCount === 0 ? <>
            {/* No student linked yet: the attendance card is not the news, the
                missing link is. Opens the link sheet on the student list. */}
            <Text accessibilityRole="header" style={ui.section}>{t('mentorStudents.emptyHint')}</Text>
            <Text style={ui.secondary}>{t('mentorStudents.linkHint')}</Text>
            <Pressable accessibilityRole="button" style={ui.primary}
              onPress={() => router.push({ pathname: '/(mentor)/student-list', params: { studentId: '', link: '1' } })}>
              <Text style={ui.primaryText}>{t('mentorStudents.link')}</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </Pressable>
          </> : daysWaiting ? <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 24 }}>
              <Text accessibilityRole="header" style={ui.section}>{t('mentorHome.daysWaiting', { count: daysWaiting })}</Text>
              <Stamp kind="pending" />
            </View>
            <Text style={ui.secondary}>{t('days.mentorIntro')}</Text>
            <View style={{ borderTopWidth: 1, borderColor: colors.rule }} />
            <Pressable accessibilityRole="button" style={ui.primary}
              onPress={() => router.push('/(mentor)/internship-days')}>
              <Text style={ui.primaryText}>{t('mentorHome.confirmDays')}</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </Pressable>
          </> : <>
            <Text accessibilityRole="header" style={ui.section}>{t('days.noPending')}</Text>
            <Text style={ui.secondary}>{t('mentorHome.daysEmptyHint')}</Text>
          </>}
      </View>

      <View style={{ borderTopWidth: 1, borderColor: colors.rule }}>
        {/* The "Reviewed this week / approval rate" quick summary is gone
            (I3): reviewed_by is now the group's advisor, never the mentor, so
            those figures were structurally always 0 / "No reviews yet".
            statsFailed still surfaces a real fetch failure (assignedCount and
            statusLine above depend on the same stats), just with nothing left
            to retry into. */}
        {statsFailed && <LoadFailedBanner onRetry={load} />}
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
