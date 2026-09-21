import { useCallback, useMemo, useRef, useState } from 'react';
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
import { logService } from '@/services/logs';
import { internshipDayService } from '@/services/internshipDays';
import { useStudentTasks } from '@/hooks/useStudentTasks';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { sortTasks, isActionable } from '@/utils/studentTasks';
import { LoadFailedBanner, Stamp } from '@/components/common';
import { StudentHeader, JobCard, ui } from '@/components/student/StudentUI';
import { StudentHeaderAvatar } from '@/components/student/StudentHeaderAvatar';
import { colors, fonts } from '@/theme';
import type { CompetencyProgress } from '@/types/competency';
import type { MyAssignment } from '@/types/assignment';
import type { InternshipDay } from '@/types/internshipDay';
import { toLocalIsoDate } from '@/utils/localDate';

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

/** One cell of the attendance strip: a weekday of the current week. */
interface DayCell {
  iso: string;
  weekday: string;
  /** A day row exists (checked in live, or declared with a reason). */
  recorded: boolean;
  checkInAt: string | null;
  attendance: InternshipDay['attendance'] | null;
  isToday: boolean;
}

/** Monday to Friday, plus a weekend day only when a record exists for it.
 *  Simulation finding #13: the strip used to mark only live check-ins, so a
 *  week declared with reasons and marked present by the mentor showed one ✓
 *  next to a days screen showing six. A record is a record. */
function buildDayCells(days: InternshipDay[], monday: Date, todayIso: string, lang: string): DayCell[] {
  const cells: DayCell[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const iso = toLocalIsoDate(date);
    const day = days.find((d) => d.day_date === iso);
    if (i >= 5 && !day) continue;
    cells.push({ iso, weekday: date.toLocaleDateString(lang, { weekday: 'short' }), recorded: !!day,
      checkInAt: day?.check_in_at ?? null, attendance: day?.attendance ?? null, isToday: iso === todayIso });
  }
  return cells;
}

interface TaskRow {
  key: string;
  weekday: string;
  title: string;
  subtitle?: string;
  status: 'approved' | 'revision' | 'pending';
  date: Date;
  shortDate: string;
}

/** Task events of the week -- submitted, sent back or approved -- oldest
 *  first. Attendance is the strip above, never a row here. */
function buildTaskRows(items: MyAssignment[], monday: Date, sunday: Date, lang: string): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const task of items) {
    const submission = task.submission;
    if (!submission) continue;
    const eventIso = submission.status === 'submitted' ? submission.submittedAt
      : submission.reviewedAt || submission.submittedAt;
    if (!eventIso) continue;
    const eventDate = new Date(eventIso);
    if (eventDate < monday || eventDate > sunday) continue;
    rows.push({
      key: task.id,
      weekday: eventDate.toLocaleDateString(lang, { weekday: 'short' }),
      title: taskContent(task.title, lang),
      subtitle: competencyContent(task.competencyName, lang),
      status: submission.status === 'approved' ? 'approved' : submission.status === 'needs_revision' ? 'revision' : 'pending',
      date: eventDate,
      shortDate: eventDate.toLocaleDateString(lang, { month: 'short', day: 'numeric' }),
    });
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows;
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
  const [hasArchive, setHasArchive] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const requestId = useRef(0);
  const loadProfile = useCallback(async () => {
    const request = ++requestId.current;
    setProfileFailed(false);
    setStatsLoading(true);
    try {
      if (!user) return;
      const [{ data: profile, error }, progressRows, archived] = await Promise.all([
        supabase.from('student_profiles')
          .select('university, department, company_name, student_id, internship_start_date, internship_end_date, total_xp, current_level, current_streak, longest_streak')
          .eq('id', user.id).maybeSingle(),
        competencyService.getProgress(user.id),
        // Optional: a failed count only hides the archive link.
        logService.hasLogs(user.id).catch(() => false),
      ]);
      if (request !== requestId.current) return;
      if (error) throw error;
      setHasArchive(archived);
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
        const days = await internshipDayService.week(user.id, toLocalIsoDate(monday));
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
  const todayIso = useMemo(() => toLocalIsoDate(new Date()), []);
  const goToInternshipDays = useCallback(() => router.push('/(student)/internship-days'), [router]);
  const dayCells = useMemo(() => buildDayCells(weekCheckins, monday, todayIso, i18n.language),
    [weekCheckins, monday, todayIso, i18n.language]);
  const taskRows = useMemo(() => buildTaskRows(tasks.items, monday, sunday, i18n.language).slice(-3),
    [tasks.items, monday, sunday, i18n.language]);
  const atTarget = progress ? progress.filter((c) => c.currentLevel >= c.targetLevel).length : 0;

  const info = profileSummary && dayInfo(profileSummary.startDate, profileSummary.endDate);
  const dayLine = profileSummary && info
    ? (info.ended
      ? t('dash.dayLineEnded', 'Internship period ended · {{company}}', { company: profileSummary.companyName })
      : t('dash.dayLine', 'Day {{day}} of your internship · {{company}}', { day: info.day, company: profileSummary.companyName }))
    : t('studentFlow.homeHint');

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={tasks.refreshing && !tasks.loading} onRefresh={refresh} />}>
      <StudentHeader title={t('studentFlow.greeting', { name: user?.firstName || '' })} leading={<StudentHeaderAvatar />} />
      <Text style={[ui.secondary, { marginTop: -12 }]}>{dayLine}</Text>

      <View style={{ gap: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 10 }}>
          <Text style={ui.section}>{t('dash.thisWeek', 'This week')}</Text>
          <Pressable accessibilityRole="button" onPress={goToInternshipDays} hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text style={{ fontSize: 14, color: colors.ink, fontFamily: fonts.medium }}>{t('dash.myDays', 'My internship days')}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.ink} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {dayCells.map((cell) => {
            const checkedIn = cell.recorded;
            const absent = cell.attendance === 'absent';
            const time = cell.checkInAt ? new Date(cell.checkInAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : '';
            const a11y = `${cell.weekday}: ${checkedIn ? (cell.attendance && cell.attendance !== 'pending' ? t('days.' + cell.attendance) : t('dash.checkedIn', 'At the internship')) + (time ? ' ' + time : '')
              : cell.isToday ? t('dash.checkIn', 'Check in') : '—'}`;
            const prompt = cell.isToday && !checkedIn;
            const markColor = absent ? colors.warnText : cell.attendance === 'pending' ? colors.textSecondary : colors.stamp;
            // Three fixed lines per cell (day / mark / time) so the days line
            // up across the strip whatever each cell has to show.
            const cellStyle = {
              flex: 1, alignItems: 'center' as const, paddingVertical: 8, borderRadius: 6, borderWidth: 1,
              borderColor: cell.isToday ? colors.ink : 'transparent',
              backgroundColor: prompt ? colors.ink : 'transparent',
            };
            const inner = <>
              <Text style={{ fontSize: 12, lineHeight: 16, color: prompt ? colors.textOnPrimary : colors.textSecondary, fontFamily: fonts.regular }}>{cell.weekday}</Text>
              {checkedIn
                ? <Text style={{ fontSize: 16, lineHeight: 24, color: markColor, fontFamily: fonts.semibold }}>{absent ? '✗' : '✓'}</Text>
                : prompt
                  ? <Text style={{ fontSize: 13, lineHeight: 24, color: colors.textOnPrimary, fontFamily: fonts.medium }}>{t('dash.checkIn', 'Check in')}</Text>
                  : <Text style={{ fontSize: 16, lineHeight: 24, color: colors.ruleStrong, fontFamily: fonts.regular }}>·</Text>}
              <Text style={{ fontSize: 11, lineHeight: 14, color: colors.textSecondary, fontFamily: fonts.regular, fontVariant: ['tabular-nums'] }}>{checkedIn ? time : ' '}</Text>
            </>;
            return prompt
              ? <Pressable key={cell.iso} accessibilityRole="button" accessibilityLabel={a11y} onPress={goToInternshipDays} style={cellStyle}>{inner}</Pressable>
              : <View key={cell.iso} accessible accessibilityLabel={a11y} style={cellStyle}>{inner}</View>;
          })}
        </View>
        {taskRows.length > 0 && <View style={{ borderTopWidth: 1, borderColor: colors.ruleStrong, marginTop: 10 }}>
          {taskRows.map((row) => <View key={row.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.divider }}>
            <Text style={{ width: 34, fontSize: 13, color: colors.textSecondary, fontVariant: ['tabular-nums'], fontFamily: fonts.regular }}>{row.weekday}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 15, color: colors.text, fontFamily: fonts.regular }}>{row.title}</Text>
              {!!row.subtitle && <Text style={{ fontSize: 12.5, color: colors.textSecondary, fontFamily: fonts.regular }}>{row.subtitle}</Text>}
            </View>
            <Stamp kind={row.status} date={row.status === 'approved' ? row.shortDate : undefined} />
          </View>)}
        </View>}
      </View>

      {tasks.failed && <LoadFailedBanner onRetry={tasks.reload} />}
      {tasks.loading ? <ActivityIndicator size="large" color={colors.primary} /> :
        next ? <JobCard task={next} /> : !tasks.failed && <View style={ui.card}>
          <Text style={ui.section}>{t(tasks.hasGroup ? 'studentFlow.allCaughtUp' : 'student.noGroupTasks')}</Text>
          <Text style={ui.secondary}>{t(tasks.hasGroup ? 'studentFlow.checkTasks' : 'student.groupCodeHint')}</Text>
          {/* The join form lives on the profile; a student who has no group
              yet must not have to find it. `join=1` opens it on arrival. */}
          {!tasks.hasGroup && <Pressable accessibilityRole="button" style={ui.primary}
            onPress={() => router.push({ pathname: '/(student)/profile', params: { join: '1' } })}>
            <Text style={ui.primaryText}>{t('student.joinGroup')}</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </Pressable>}
        </View>}

      {profileFailed && <LoadFailedBanner onRetry={loadProfile} />}
      {statsLoading ? <ActivityIndicator color={colors.primary} /> : !!progress && <Pressable accessibilityRole="button"
        onPress={() => router.push('/(student)/achievements')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.rule }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={ui.label}>{t('studentFlow.competencies_title', 'Competencies')}</Text>
          <Text style={ui.secondary}>
            {t('dash.atTarget', '{{count}} of {{total}} at target', { count: atTarget, total: progress.length })}
            {' · '}{totalXp} XP · {t('gamification.level')} {currentLevel}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.ink} />
      </Pressable>}

      <View style={{ flexDirection: 'row', gap: 18 }}>
        <Pressable accessibilityRole="button" hitSlop={12} style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={() => router.push('/(student)/leaderboard')}>
          <Text style={[ui.link, { fontSize: 14 }]}>{t('tabs.ranking')}</Text>
        </Pressable>
        {hasArchive && <Pressable accessibilityRole="button" hitSlop={12} style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={() => router.push('/(student)/log-history')}>
          <Text style={[ui.link, { fontSize: 14 }]}>{t('studentFlow.archive')}</Text>
        </Pressable>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
