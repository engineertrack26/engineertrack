import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { taskContent } from '@/utils/taskContent';
import { competencyContent } from '@/utils/competencyContent';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { supabase } from '@/services/supabase';
import { competencyService } from '@/services/competency';
import { internshipDayService } from '@/services/internshipDays';
import { useStudentTasks } from '@/hooks/useStudentTasks';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { sortTasks, isActionable } from '@/utils/studentTasks';
import { LoadFailedBanner, Stamp, LevelRail } from '@/components/common';
import { StudentHeader, JobCard, ui } from '@/components/student/StudentUI';
import { colors, fonts } from '@/theme';
import type { CompetencyProgress } from '@/types/competency';
import type { MyAssignment } from '@/types/assignment';
import type { InternshipDay } from '@/types/internshipDay';

interface ProfileSummary {
  companyName: string;
  startDate: string;
  endDate: string;
}

/** DATE columns are calendar dates -- parsed as local, not UTC, the same way
 *  taskDueDate in utils/studentTasks does it. */
function parseCalendarDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function dayInfo(startDate: string, endDate: string): { ended: boolean; day: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = parseCalendarDate(endDate);
  end.setHours(0, 0, 0, 0);
  if (today > end) return { ended: true, day: 0 };
  const start = parseCalendarDate(startDate);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - start.getTime()) / 86400000);
  return { ended: false, day: Math.max(1, diffDays + 1) };
}

function weekRange(now = new Date()): { monday: Date; sunday: Date } {
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface WeekRow {
  key: string;
  weekday: string;
  title: string;
  subtitle?: string;
  right: ReactNode;
  /** Set only on the "check in today" prompt -- the row is a button rather
   *  than a plain information line. */
  onPress?: () => void;
}

function checkinRight(lang: string, checkInAt: string): ReactNode {
  const time = new Date(checkInAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  return <Text style={{ fontSize: 13, fontWeight: '500', fontFamily: fonts.medium, color: colors.stamp }}>{`✓ ${time}`}</Text>;
}

/** The ledger's first row is always today, whether or not there is anything
 *  to show yet: checked in already -> a plain row like any other day;
 *  otherwise a button that is the dashboard's one remaining entry point into
 *  the internship-days check-in screen (the old quick-link card is gone).
 *  Rendered even when the days service call failed -- that screen explains
 *  its own unavailability, this row must not silently disappear instead. */
function buildTodayRow(
  checkins: InternshipDay[], todayIso: string, lang: string,
  checkedInLabel: string, checkInPromptLabel: string, onCheckIn: () => void,
): WeekRow {
  const weekday = parseCalendarDate(todayIso).toLocaleDateString(lang, { weekday: 'short' });
  const today = checkins.find((d) => d.day_date === todayIso);
  if (today?.check_in_at) {
    return { key: 'today', weekday, title: checkedInLabel, right: checkinRight(lang, today.check_in_at) };
  }
  return {
    key: 'today', weekday, title: checkInPromptLabel,
    right: <Ionicons name="chevron-forward" size={18} color={colors.ink} />,
    onPress: onCheckIn,
  };
}

/** Every other row in the week: earlier check-ins plus task submissions,
 *  merged and sorted oldest-first (today's own check-in is handled above
 *  and excluded here so it is never shown twice). */
function buildOtherRows(
  items: MyAssignment[], checkins: InternshipDay[], monday: Date, sunday: Date, todayIso: string,
  lang: string, checkedInLabel: string,
): WeekRow[] {
  const dated: { date: Date; row: WeekRow }[] = [];
  for (const d of checkins) {
    if (!d.check_in_at || d.day_date === todayIso) continue;
    dated.push({
      date: new Date(d.check_in_at),
      row: {
        key: `checkin-${d.id}`,
        weekday: parseCalendarDate(d.day_date).toLocaleDateString(lang, { weekday: 'short' }),
        title: checkedInLabel,
        right: checkinRight(lang, d.check_in_at),
      },
    });
  }
  for (const task of items) {
    const submission = task.submission;
    if (!submission) continue;
    const eventIso = submission.status === 'submitted' ? submission.submittedAt
      : submission.reviewedAt || submission.submittedAt;
    if (!eventIso) continue;
    const eventDate = new Date(eventIso);
    if (eventDate < monday || eventDate > sunday) continue;
    const shortDate = eventDate.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
    const right = submission.status === 'approved' ? <Stamp kind="approved" date={shortDate} />
      : submission.status === 'needs_revision' ? <Stamp kind="revision" />
      : <Stamp kind="pending" />;
    dated.push({
      date: eventDate,
      row: {
        key: task.id,
        weekday: eventDate.toLocaleDateString(lang, { weekday: 'short' }),
        title: taskContent(task.title, lang),
        subtitle: competencyContent(task.competencyName, lang),
        right,
      },
    });
  }
  dated.sort((a, b) => a.date.getTime() - b.date.getTime());
  return dated.map((r) => r.row);
}

export default function StudentDashboard() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const { totalXp, currentLevel, setXp, setLevel, setStreak } = useGamificationStore();
  const tasks = useStudentTasks();
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [progress, setProgress] = useState<CompetencyProgress[] | null>(null);
  const [weekCheckins, setWeekCheckins] = useState<InternshipDay[]>([]);
  const [profileFailed, setProfileFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const requestId = useRef(0);
  const loadProfile = useCallback(async () => {
    const request = ++requestId.current;
    setProfileFailed(false);
    setStatsLoading(true);
    try {
      if (!user) return;
      const [{ data: profile, error }, progressRows] = await Promise.all([
        supabase.from('student_profiles')
          .select('university, department, company_name, student_id, internship_start_date, internship_end_date, total_xp, current_level, current_streak, longest_streak')
          .eq('id', user.id).maybeSingle(),
        competencyService.getProgress(user.id),
      ]);
      if (request !== requestId.current) return;
      if (error) throw error;
      if (!profile || !profile.university || !profile.department || !profile.company_name ||
          !profile.student_id || !profile.internship_start_date || !profile.internship_end_date) {
        router.replace('/(student)/internship-form?return=dashboard');
        return;
      }
      setXp(profile.total_xp || 0);
      setLevel(profile.current_level || 1);
      setStreak(profile.current_streak || 0, profile.longest_streak || 0);
      setProfileSummary({
        companyName: profile.company_name,
        startDate: profile.internship_start_date,
        endDate: profile.internship_end_date,
      });
      setProgress(progressRows);
      try {
        const { monday } = weekRange();
        const days = await internshipDayService.week(user.id, isoDate(monday));
        if (request === requestId.current) setWeekCheckins(days);
      } catch {
        if (request === requestId.current) setWeekCheckins([]);
      }
    } catch {
      if (request === requestId.current) setProfileFailed(true);
    } finally {
      if (request === requestId.current) setStatsLoading(false);
    }
  }, [user, router, setXp, setLevel, setStreak]);
  useFocusEffect(useCallback(() => {
    void loadProfile();
    return () => { requestId.current++; };
  }, [loadProfile]));
  useRealtimeSubscription({
    table: 'assignment_submissions', filter: user ? 'student_id=eq.' + user.id : undefined,
    event: 'UPDATE', enabled: !!user, onPayload: () => { void tasks.reload(); void loadProfile(); },
  });
  const actionable = useMemo(() => sortTasks(tasks.items).filter(isActionable), [tasks.items]);
  const next = actionable[0];
  const refresh = () => { void tasks.reload(); void loadProfile(); };

  const { monday, sunday } = useMemo(() => weekRange(), []);
  const todayIso = useMemo(() => isoDate(new Date()), []);
  const checkedInLabel = t('dash.checkedIn', 'At the internship');
  const checkInPromptLabel = t('dash.checkInToday', "I'm at the internship today");
  const goToInternshipDays = useCallback(() => router.push('/(student)/internship-days'), [router]);
  const weekRows = useMemo(() => [
    buildTodayRow(weekCheckins, todayIso, i18n.language, checkedInLabel, checkInPromptLabel, goToInternshipDays),
    ...buildOtherRows(tasks.items, weekCheckins, monday, sunday, todayIso, i18n.language, checkedInLabel),
  ], [weekCheckins, tasks.items, monday, sunday, todayIso, i18n.language, checkedInLabel, checkInPromptLabel, goToInternshipDays]);
  const weekRangeLabel = `${monday.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })}`;

  const info = profileSummary && dayInfo(profileSummary.startDate, profileSummary.endDate);
  const dayLine = profileSummary && info
    ? (info.ended
      ? t('dash.dayLineEnded', 'Internship period ended · {{company}}', { company: profileSummary.companyName })
      : t('dash.dayLine', 'Day {{day}} of your internship · {{company}}', { day: info.day, company: profileSummary.companyName }))
    : t('studentFlow.homeHint');

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={tasks.refreshing && !tasks.loading} onRefresh={refresh} />}>
      <StudentHeader title="EngineerTrack" />

      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={ui.title}>{t('studentFlow.greeting', { name: user?.firstName || '' })}</Text>
        <Text style={ui.secondary}>{dayLine}</Text>
      </View>

      {tasks.failed && <LoadFailedBanner onRetry={tasks.reload} />}
      {tasks.loading ? <ActivityIndicator size="large" color={colors.primary} /> :
        next ? <JobCard task={next} /> : !tasks.failed && <View style={ui.card}>
          <Text style={ui.section}>{t(tasks.hasGroup ? 'studentFlow.allCaughtUp' : 'student.noGroupTasks')}</Text>
          <Text style={ui.secondary}>{t('studentFlow.checkTasks')}</Text>
        </View>}

      <View style={{ gap: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}>
          <Text style={ui.section}>{t('dash.thisWeek', 'This week')}</Text>
          <Text style={ui.secondary}>{weekRangeLabel}</Text>
        </View>
        <View style={{ borderTopWidth: 1, borderColor: colors.ruleStrong }} />
        {weekRows.length === 0 ? <Text style={[ui.secondary, { paddingVertical: 12 }]}>
          {t('dash.weekEmpty', 'Nothing recorded this week yet.')}
        </Text> : weekRows.map((row) => {
          const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.divider };
          const inner = <>
            <Text style={{ width: 34, fontSize: 13, color: colors.textSecondary, fontVariant: ['tabular-nums' as const], fontFamily: fonts.regular }}>{row.weekday}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={row.onPress
                ? { fontSize: 15, color: colors.ink, fontFamily: fonts.medium }
                : { fontSize: 15, color: colors.text, fontFamily: fonts.regular }}>{row.title}</Text>
              {!!row.subtitle && <Text style={{ fontSize: 12.5, color: colors.textSecondary, fontFamily: fonts.regular }}>{row.subtitle}</Text>}
            </View>
            {row.right}
          </>;
          return row.onPress
            ? <Pressable key={row.key} accessibilityRole="button" onPress={row.onPress} style={rowStyle}>{inner}</Pressable>
            : <View key={row.key} style={rowStyle}>{inner}</View>;
        })}
      </View>

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={ui.section}>{t('studentFlow.competencies_title', 'Competencies')}</Text>
          <Text style={ui.secondary}>{t('dash.targetHint', 'target: dashed')}</Text>
        </View>
        {profileFailed && <LoadFailedBanner onRetry={loadProfile} />}
        {statsLoading ? <ActivityIndicator color={colors.primary} /> : progress && <>
          {progress.map((c) => <View key={c.competencyId}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={ui.body}>{competencyContent(c.name, i18n.language)}</Text>
              <Text style={ui.secondary}>{c.currentLevel} / {c.targetLevel}</Text>
            </View>
            <LevelRail current={c.currentLevel} target={c.targetLevel}
              label={`${competencyContent(c.name, i18n.language)} ${c.currentLevel}/${c.targetLevel}`} />
          </View>)}
          <Text style={ui.secondary}>{totalXp} XP · {t('gamification.level')} {currentLevel}</Text>
        </>}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, rowGap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(student)/feed')}>
          <Text style={ui.link}>{t('tabs.feed')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(student)/leaderboard')}>
          <Text style={ui.link}>{t('tabs.ranking')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(student)/log-history')}>
          <Text style={ui.link}>{t('studentFlow.archive')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={goToInternshipDays}>
          <Text style={ui.link}>{t('dash.myDays', 'My internship days')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
