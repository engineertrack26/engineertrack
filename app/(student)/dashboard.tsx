import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { assignmentService } from '@/services/assignments';
import { groupService } from '@/services/group';
import { notificationService } from '@/services/notifications';
import { supabase } from '@/services/supabase';
import { StatCard, ProgressBar } from '@/components/common';
import { AppNotification } from '@/types/notification';
import { LEVELS } from '@/types/gamification';
import type { MyAssignment } from '@/types/assignment';
import type { GroupSummary } from '@/types/group';
import { groupAssignmentsByState } from '@/utils/assignmentGrouping';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { colors, spacing, borderRadius } from '@/theme';

export default function StudentDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { totalXp, currentLevel, currentStreak } = useGamificationStore();
  const setXp = useGamificationStore((s) => s.setXp);
  const setLevel = useGamificationStore((s) => s.setLevel);
  const setStreak = useGamificationStore((s) => s.setStreak);

  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Notification state
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const currentLevelData = LEVELS.find((l) => l.level === currentLevel) || LEVELS[0];
  const nextLevelData = LEVELS.find((l) => l.level === currentLevel + 1);
  const xpProgress = nextLevelData
    ? (totalXp - currentLevelData.minXp) / (nextLevelData.minXp - currentLevelData.minXp)
    : 1;
  const xpToNextLevel = nextLevelData ? nextLevelData.minXp - totalXp : 0;

  // A missing submission row IS the "to do" state -- groupAssignmentsByState
  // already encodes that rule, so counts derive from it rather than a second
  // hand-rolled tally that could drift from what my-tasks.tsx shows.
  const taskGroups = useMemo(() => groupAssignmentsByState(assignments), [assignments]);
  const revisionCount = taskGroups.revise.length;
  const todoCount = taskGroups.todo.length;
  const approvedCount = taskGroups.done.length;
  const submittedCount = taskGroups.revise.length + taskGroups.waiting.length + taskGroups.done.length;
  const completionRate = submittedCount > 0 ? Math.round((approvedCount / submittedCount) * 100) : 0;

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const { data: profile } = await supabase
        .from('student_profiles')
        .select(
          'university, department, company_name, student_id, internship_start_date, internship_end_date, total_xp, current_level, current_streak, longest_streak',
        )
        .eq('id', user.id)
        .maybeSingle();

      const isIncomplete =
        !profile ||
        !profile.university ||
        !profile.department ||
        !profile.company_name ||
        !profile.student_id ||
        !profile.internship_start_date ||
        !profile.internship_end_date;

      if (isIncomplete) {
        router.replace('/(student)/internship-form?return=dashboard');
        setLoading(false);
        return;
      }

      // listMyAssignments needs a group id, so the student's group has to be
      // resolved first. A student in no group is a normal state, not an
      // error -- there is simply nothing to show.
      const g = await groupService.getMyGroup(user.id);
      setGroup(g);
      const items = g ? await assignmentService.listMyAssignments(g.id, user.id) : [];
      setAssignments(items);

      // Fetch unread notifications from DB
      try {
        const unread = await notificationService.getUnread(user.id);
        const mapped: AppNotification[] = (unread || []).map((n: Record<string, unknown>) => ({
          id: n.id as string,
          userId: (n.user_id as string) || '',
          title: (n.title as string) || '',
          body: (n.body as string) || '',
          type: (n.type as AppNotification['type']) || 'general',
          isRead: (n.is_read as boolean) || false,
          data: (n.data as Record<string, unknown>) || undefined,
          createdAt: (n.created_at as string) || '',
        }));
        setNotifications(mapped);
        const fbCount = mapped.filter(
          (n) => n.type === 'log_approved' || n.type === 'new_feedback',
        ).length;
        setFeedbackCount(fbCount);
      } catch {
        setNotifications([]);
        setFeedbackCount(0);
      }

      if (profile) {
        setXp(profile.total_xp || 0);
        setLevel(profile.current_level || 1);
        setStreak(profile.current_streak || 0, profile.longest_streak || 0);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, setXp, setLevel, setStreak]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: auto-refresh when a submission's status changes
  useRealtimeSubscription({
    table: 'assignment_submissions',
    filter: user ? `student_id=eq.${user.id}` : undefined,
    event: 'UPDATE',
    enabled: !!user,
    onPayload: () => {
      loadData();
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const hasNotifications = revisionCount > 0 || feedbackCount > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting} numberOfLines={1}>
              Hello, {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Student'}
            </Text>
            <Text style={styles.subtitle}>Student Dashboard</Text>
          </View>
          <TouchableOpacity
            style={styles.avatarPlaceholder}
            onPress={() => router.push('/(student)/profile')}
            activeOpacity={0.7}
          >
            <Ionicons name="person" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Notification Cards */}
        {hasNotifications && (
          <View style={styles.notificationsSection}>
            {revisionCount > 0 && (
              <TouchableOpacity
                style={[styles.notifCard, { borderLeftColor: colors.error }]}
                onPress={() => router.push('/(student)/my-tasks')}
                activeOpacity={0.7}
              >
                <View style={[styles.notifIconWrap, { backgroundColor: colors.error + '15' }]}>
                  <Ionicons name="alert-circle" size={22} color={colors.error} />
                </View>
                <View style={styles.notifContent}>
                  <Text style={styles.notifTitle}>Revision Needed</Text>
                  <Text style={styles.notifDesc}>
                    {revisionCount} task{revisionCount > 1 ? 's' : ''} need{revisionCount === 1 ? 's' : ''} revision
                  </Text>
                </View>
                <View style={[styles.notifBadge, { backgroundColor: colors.error }]}>
                  <Text style={styles.notifBadgeText}>{revisionCount}</Text>
                </View>
              </TouchableOpacity>
            )}

            {feedbackCount > 0 && (
              <TouchableOpacity
                style={[styles.notifCard, { borderLeftColor: colors.info }]}
                onPress={() => router.push('/(student)/log-history')}
                activeOpacity={0.7}
              >
                <View style={[styles.notifIconWrap, { backgroundColor: colors.info + '15' }]}>
                  <Ionicons name="chatbubble-ellipses" size={22} color={colors.info} />
                </View>
                <View style={styles.notifContent}>
                  <Text style={styles.notifTitle}>New Feedback</Text>
                  <Text style={styles.notifDesc}>
                    {feedbackCount} new feedback{feedbackCount > 1 ? 's' : ''} from mentor
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* My Tasks */}
        <TouchableOpacity
          style={[styles.notifCard, { borderLeftColor: colors.primary, marginBottom: spacing.sm }]}
          onPress={() => router.push('/(student)/my-tasks')}
          activeOpacity={0.7}
        >
          <View style={[styles.notifIconWrap, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="list" size={22} color={colors.primary} />
          </View>
          <View style={styles.notifContent}>
            <Text style={styles.notifTitle}>{t('student.myTasks')}</Text>
            <Text style={styles.notifDesc}>See what your advisor assigned</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Daily Survey Placeholder */}
        <TouchableOpacity
          style={[styles.notifCard, { borderLeftColor: colors.success, marginBottom: spacing.lg }]}
          activeOpacity={0.8}
        >
          <View style={[styles.notifIconWrap, { backgroundColor: colors.success + '15' }]}>
            <Ionicons name="clipboard" size={22} color={colors.success} />
          </View>
          <View style={styles.notifContent}>
            <Text style={styles.notifTitle}>Daily Survey</Text>
            <Text style={styles.notifDesc}>Coming Soon</Text>
          </View>
          <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard
              title={t('student.totalXp')}
              value={totalXp}
              icon="flash"
              color={colors.gamification.xp}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title={t('student.level')}
              value={currentLevel}
              icon="arrow-up-circle"
              color={colors.gamification.levelUp}
            />
          </View>
          <View style={styles.statsRow}>
            <StatCard
              title={t('student.streak')}
              value={`${currentStreak}w`}
              icon="flame"
              color={colors.gamification.streak}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title={t('student.completionRate')}
              value={`${completionRate}%`}
              icon="checkmark-done"
              color={colors.secondary}
            />
          </View>
        </View>

        {/* XP Progress */}
        <View style={styles.xpSection}>
          <View style={styles.xpHeader}>
            <Text style={styles.sectionTitle}>{t('gamification.xp')} Progress</Text>
            <Text style={styles.xpLabel}>
              {totalXp} / {nextLevelData ? nextLevelData.minXp : '---'} XP
            </Text>
          </View>
          <ProgressBar progress={xpProgress} color={colors.gamification.xp} height={12} />
          {nextLevelData && (
            <Text style={styles.xpHint}>
              {xpToNextLevel} XP to {t(nextLevelData.nameKey)}
            </Text>
          )}
        </View>

        {/* Tasks To Do */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('student.tasksToDo')}</Text>
          <TouchableOpacity
            style={styles.taskCard}
            onPress={() => router.push('/(student)/my-tasks')}
            activeOpacity={0.7}
          >
            <Ionicons name="list-circle" size={32} color={colors.primary} />
            <Text style={styles.taskCardTitle}>{t('student.tasksToDo')}</Text>
            <Text style={styles.taskCardHint}>{t('student.tasksToDoCount', { count: todoCount })}</Text>
          </TouchableOpacity>
        </View>

        {/* Archive link */}
        <TouchableOpacity
          style={styles.archiveLink}
          onPress={() => router.push('/(student)/log-history')}
          activeOpacity={0.7}
        >
          <Text style={styles.archiveLinkText}>{t('student.pastLogs')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Notification Cards
  notificationsSection: {
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  notifIconWrap: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  notifContent: {
    flex: 1,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  notifDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  notifBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  notifBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },

  // Stats
  statsGrid: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
  },
  xpSection: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  xpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  xpLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gamification.xp,
  },
  xpHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  taskCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary + '30',
    borderStyle: 'dashed',
  },
  taskCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    marginTop: spacing.sm,
  },
  taskCardHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  archiveLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  archiveLinkText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginRight: 4,
  },
});
