import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { supabase } from '@/services/supabase';
import { competencyService } from '@/services/competency';
import { useStudentTasks } from '@/hooks/useStudentTasks';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { competencyCompletion, CompletionMetrics } from '@/utils/reportMetrics';
import { sortTasks, isActionable } from '@/utils/studentTasks';
import { LoadFailedBanner, ProgressBar } from '@/components/common';
import { StudentHeader, TaskCard, ui } from '@/components/student/StudentUI';
import { InternshipDaysLink } from '@/components/internship/InternshipDaysLink';
import { colors } from '@/theme';

export default function StudentDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const { totalXp, currentLevel, setXp, setLevel, setStreak } = useGamificationStore();
  const tasks = useStudentTasks();
  const [metrics, setMetrics] = useState<CompletionMetrics | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const requestId = useRef(0);
  const loadProfile = useCallback(async () => {
    const request = ++requestId.current;
    setProfileFailed(false);
    setStatsLoading(true);
    try {
      if (!user) return;
      const [{ data: profile, error }, progress] = await Promise.all([
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
      setMetrics(competencyCompletion(progress));
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
  const upcoming = actionable.filter(a => a.id !== next?.id && !!a.dueDate)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  const refresh = () => { void tasks.reload(); void loadProfile(); };

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={tasks.refreshing && !tasks.loading} onRefresh={refresh} />}>
      <StudentHeader title="EngineerTrack" />
      <InternshipDaysLink role="student" />
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={ui.title}>{t('studentFlow.greeting', { name: user?.firstName || '' })}</Text>
        <Text style={ui.secondary}>{t('studentFlow.homeHint')}</Text>
      </View>
      {tasks.failed && <LoadFailedBanner onRetry={tasks.reload} />}
      {tasks.loading ? <ActivityIndicator size="large" color={colors.primary} /> : <>
        {next ? <View style={{ gap: 12 }}>
          <Text style={ui.section}>{t('studentFlow.nextTask')}</Text>
          <TaskCard task={next} prominent />
        </View> : !tasks.failed && <View style={ui.card}>
          <Text style={ui.section}>{t(tasks.hasGroup ? 'studentFlow.allCaughtUp' : 'student.noGroupTasks')}</Text>
          <Text style={ui.secondary}>{t('studentFlow.checkTasks')}</Text>
        </View>}
        <Pressable accessibilityRole="button" onPress={() => router.push('/(student)/my-tasks')}>
          <Text style={ui.link}>{t('studentFlow.allTasks')} ({tasks.items.length}) →</Text>
        </Pressable>
        {!!upcoming && <View style={{ gap: 12 }}>
          <Text style={ui.section}>{t('studentFlow.upcoming')}</Text>
          <TaskCard task={upcoming} />
        </View>}
      </>}
      <View style={{ gap: 12 }}>
        <Text style={ui.section}>{t('studentFlow.growth')}</Text>
        {profileFailed && <LoadFailedBanner onRetry={loadProfile} />}
        {statsLoading ? <ActivityIndicator color={colors.primary} /> : metrics && <Pressable
          accessibilityRole="button" accessibilityLabel={t('studentFlow.growth')} onPress={() => router.push('/(student)/achievements')} style={ui.card}>
          <Text style={ui.label}>{t('studentFlow.competencies', { completed: metrics.atTarget, total: metrics.targeted })}</Text>
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t('studentFlow.growth')}
            accessibilityValue={{ min: 0, max: 100, now: metrics.percent }}>
            <ProgressBar progress={metrics.percent / 100} />
          </View>
          <Text style={ui.secondary}>{totalXp} XP · {t('gamification.level')} {currentLevel}</Text>
          <Text style={ui.link}>{t('studentFlow.viewGrowth')} →</Text>
        </Pressable>}
      </View>
      <View style={ui.card}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(student)/feed')}>
          <Text style={ui.link}>{t('tabs.feed')} →</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(student)/leaderboard')}>
          <Text style={ui.link}>{t('tabs.ranking')} →</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(student)/log-history')}>
          <Text style={ui.link}>{t('studentFlow.archive')} →</Text>
        </Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
