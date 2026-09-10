import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { mentorService } from '@/services/mentor';
import { assignmentService } from '@/services/assignments';
import { supabase } from '@/services/supabase';
import { StatCard } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';
import type { AssignmentSubmission, GroupAssignment } from '@/types/assignment';

interface StudentItem {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
  internshipStartDate?: string;
  internshipEndDate?: string;
}

type PendingReviewPreview = AssignmentSubmission & { assignment: GroupAssignment };

function mapStudent(row: Record<string, unknown>): StudentItem {
  const profile = row.profiles as Record<string, unknown> | null;
  return {
    id: row.id as string,
    firstName: (profile?.first_name as string) || '',
    lastName: (profile?.last_name as string) || '',
    avatarUrl: (profile?.avatar_url as string) || undefined,
    totalXp: (row.total_xp as number) || 0,
    currentLevel: (row.current_level as number) || 1,
    currentStreak: (row.current_streak as number) || 0,
    internshipStartDate: (row.internship_start_date as string) || undefined,
    internshipEndDate: (row.internship_end_date as string) || undefined,
  };
}

export default function MentorDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<{
    assignedCount: number;
    pendingCount: number;
    reviewedThisWeek: number;
    approvalRate: number | null;
  }>({
    assignedCount: 0,
    pendingCount: 0,
    reviewedThisWeek: 0,
    approvalRate: null,
  });
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [pendingPreview, setPendingPreview] = useState<PendingReviewPreview[]>([]);
  const [studentNames, setStudentNames] = useState<Record<string, { firstName: string; lastName: string }>>({});

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      // One fetch for the pending-review queue: its length is the "Pending
      // Reviews" count and its first few rows are the preview list below.
      // This used to be two separate questions -- getDashboardStats counting
      // daily_logs, and listPendingReviews counting assignment_submissions --
      // that could disagree once both read the same table.
      const [result, pendingReviews] = await Promise.all([
        mentorService.getDashboardStats(user.id),
        assignmentService.listPendingReviews(),
      ]);
      setStats({
        assignedCount: result.assignedCount,
        pendingCount: pendingReviews.length,
        reviewedThisWeek: result.reviewedThisWeek,
        approvalRate: result.approvalRate,
      });
      setStudents(
        (result.students || []).slice(0, 5).map((s) => mapStudent(s as unknown as Record<string, unknown>)),
      );

      const preview = pendingReviews.slice(0, 5);
      setPendingPreview(preview);

      // The submission/assignment shape carries a student id, not a name --
      // resolved the same way app/(mentor)/pending-reviews.tsx resolves it:
      // one batched query keyed by the ids already in hand.
      const ids = Array.from(new Set(preview.map((p) => p.studentId).filter(Boolean)));
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', ids);
        if (error) throw error;
        const names: Record<string, { firstName: string; lastName: string }> = {};
        for (const row of data || []) {
          const r = row as Record<string, unknown>;
          names[r.id as string] = {
            firstName: (r.first_name as string) || '',
            lastName: (r.last_name as string) || '',
          };
        }
        setStudentNames(names);
      } else {
        setStudentNames({});
      }
    } catch (err) {
      console.error('Mentor dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

  const getWaitTime = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

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
              Hello, {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Mentor'}
            </Text>
            <Text style={styles.subtitle}>Mentor Dashboard</Text>
          </View>
          <TouchableOpacity
            style={styles.avatarPlaceholder}
            onPress={() => router.push('/(mentor)/profile')}
            activeOpacity={0.7}
          >
            <Ionicons name="person" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard
              title="Assigned Students"
              value={stats.assignedCount}
              icon="people"
              color={colors.primary}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title="Pending Reviews"
              value={stats.pendingCount}
              icon="time"
              color={colors.warning}
            />
          </View>
          <View style={styles.statsRow}>
            <StatCard
              title="Reviewed This Week"
              value={stats.reviewedThisWeek}
              icon="checkmark-done"
              color={colors.success}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title={t('mentor.approvalRate')}
              value={stats.approvalRate !== null ? `${stats.approvalRate}%` : '-'}
              icon="thumbs-up"
              color={colors.success}
            />
          </View>
        </View>

        {/* Pending Reviews -- task submissions awaiting this mentor's review.
            One queue, fetched once (see loadData): the count above, the
            preview list here, and the full list on pending-reviews.tsx all
            read the same assignment_submissions rows. */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {t('mentor.pendingTaskReviews')}
              {stats.pendingCount > 0 && (
                <Text style={styles.countBadge}> ({stats.pendingCount})</Text>
              )}
            </Text>
            {pendingPreview.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/(mentor)/pending-reviews')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            )}
          </View>

          {pendingPreview.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="checkmark-circle" size={40} color={colors.success} />
              <Text style={styles.emptyTitle}>All caught up!</Text>
              <Text style={styles.emptyText}>{t('mentor.noPendingReviews')}</Text>
            </View>
          ) : (
            pendingPreview.map((item) => {
              const name = studentNames[item.studentId];
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.pendingCard}
                  onPress={() => router.push('/(mentor)/pending-reviews')}
                  activeOpacity={0.7}
                >
                  <View style={styles.pendingLeft}>
                    <View style={styles.pendingAvatar}>
                      <Text style={styles.pendingInitials}>
                        {getInitials(name?.firstName || '', name?.lastName || '')}
                      </Text>
                    </View>
                    <View style={styles.pendingInfo}>
                      <Text style={styles.pendingStudent} numberOfLines={1}>
                        {name ? `${name.firstName} ${name.lastName}` : ''}
                      </Text>
                      <Text style={styles.pendingTitle} numberOfLines={1}>{item.assignment.title}</Text>
                      <Text style={styles.pendingDate}>
                        {new Date(item.submittedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.pendingRight}>
                    <Text style={styles.waitTime}>{getWaitTime(item.submittedAt)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* My Students */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Students</Text>
            {students.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/(mentor)/student-list')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            )}
          </View>

          {students.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={40} color={colors.textDisabled} />
              <Text style={styles.emptyTitle}>No students yet</Text>
              <Text style={styles.emptyText}>Students will appear here once assigned.</Text>
            </View>
          ) : (
            students.map((student) => (
              <TouchableOpacity
                key={student.id}
                style={styles.studentCard}
                onPress={() => router.push('/(mentor)/student-list')}
                activeOpacity={0.7}
              >
                <View style={styles.studentAvatar}>
                  <Text style={styles.studentInitials}>
                    {getInitials(student.firstName, student.lastName)}
                  </Text>
                </View>
                <View style={styles.studentInfo}>
                  <Text style={styles.studentName} numberOfLines={1}>
                    {student.firstName} {student.lastName}
                  </Text>
                  <View style={styles.studentMeta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="flash" size={13} color={colors.gamification.xp} />
                      <Text style={styles.metaText}>{student.totalXp} XP</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="arrow-up-circle" size={13} color={colors.gamification.levelUp} />
                      <Text style={styles.metaText}>Lvl {student.currentLevel}</Text>
                    </View>
                    {student.currentStreak > 0 && (
                      <View style={styles.metaItem}>
                        <Ionicons name="flame" size={13} color={colors.gamification.streak} />
                        <Text style={styles.metaText}>{student.currentStreak}w</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
              </TouchableOpacity>
            ))
          )}
        </View>

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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header
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

  // Stats
  statsGrid: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
  },

  // Sections
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  countBadge: {
    color: colors.warning,
    fontWeight: '700',
  },
  seeAll: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },

  // Empty
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.sm,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // Pending Cards
  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  pendingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  pendingAvatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.warning + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  pendingInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.warning,
  },
  pendingInfo: {
    flex: 1,
  },
  pendingStudent: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  pendingTitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  pendingDate: {
    fontSize: 11,
    color: colors.textDisabled,
    marginTop: 2,
  },
  pendingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  waitTime: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },

  // Student Cards
  studentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  studentAvatar: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  studentInitials: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  studentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
