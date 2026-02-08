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
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { StatCard } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';

interface StudentItem {
  id: string;
  firstName: string;
  lastName: string;
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
  companyName?: string;
  completionPct: number;
}

interface PendingLogItem {
  id: string;
  title: string;
  date: string;
  createdAt: string;
  studentFirstName: string;
  studentLastName: string;
  mentorRating: number;
}

function mapStudent(row: Record<string, unknown>): StudentItem {
  const profile = row.profiles as Record<string, unknown> | null;
  const start = row.internship_start_date as string | null;
  const end = row.internship_end_date as string | null;
  let completionPct = 0;
  if (start && end) {
    const startDate = new Date(start).getTime();
    const endDate = new Date(end).getTime();
    const total = endDate - startDate;
    if (total > 0) {
      completionPct = Math.min(100, Math.max(0, Math.round(((Date.now() - startDate) / total) * 100)));
    }
  }
  return {
    id: row.id as string,
    firstName: (profile?.first_name as string) || '',
    lastName: (profile?.last_name as string) || '',
    totalXp: (row.total_xp as number) || 0,
    currentLevel: (row.current_level as number) || 1,
    currentStreak: (row.current_streak as number) || 0,
    companyName: (row.company_name as string) || undefined,
    completionPct,
  };
}

function mapPendingLog(row: Record<string, unknown>): PendingLogItem {
  const profile = row.profiles as Record<string, unknown> | null;
  const feedbacks = Array.isArray(row.mentor_feedbacks) ? row.mentor_feedbacks : [];
  const fb = feedbacks[0] as Record<string, unknown> | undefined;
  return {
    id: row.id as string,
    title: (row.title as string) || '',
    date: row.date as string,
    createdAt: (row.created_at as string) || '',
    studentFirstName: (profile?.first_name as string) || '',
    studentLastName: (profile?.last_name as string) || '',
    mentorRating: (fb?.rating as number) || 0,
  };
}

export default function AdvisorDashboard() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    assignedCount: 0,
    pendingCount: 0,
    validatedThisWeek: 0,
    avgCompletion: 0,
  });
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [pendingLogs, setPendingLogs] = useState<PendingLogItem[]>([]);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const result = await advisorService.getDashboardStats(user.id);
      setStats({
        assignedCount: result.assignedCount,
        pendingCount: result.pendingCount,
        validatedThisWeek: result.validatedThisWeek,
        avgCompletion: result.avgCompletion,
      });
      setStudents(
        (result.students || []).slice(0, 5).map((s) => mapStudent(s as unknown as Record<string, unknown>)),
      );
      setPendingLogs(
        (result.pendingLogs || []).slice(0, 5).map((l) => mapPendingLog(l as unknown as Record<string, unknown>)),
      );
    } catch (err) {
      console.error('Advisor dashboard load error:', err);
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
              Hello, {user?.firstName ? `Prof. ${user.firstName}` : 'Advisor'}
            </Text>
            <Text style={styles.subtitle}>Advisor Dashboard</Text>
          </View>
          <TouchableOpacity
            style={styles.avatarPlaceholder}
            onPress={() => router.push('/(advisor)/profile')}
            activeOpacity={0.7}
          >
            <Ionicons name="person" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard
              title="Active Students"
              value={stats.assignedCount}
              icon="people"
              color={colors.primary}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title="Pending Validations"
              value={stats.pendingCount}
              icon="time"
              color={colors.warning}
            />
          </View>
          <View style={styles.statsRow}>
            <StatCard
              title="Validated This Week"
              value={stats.validatedThisWeek}
              icon="shield-checkmark"
              color={colors.success}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title="Avg Completion"
              value={`${stats.avgCompletion}%`}
              icon="trending-up"
              color={colors.info}
            />
          </View>
        </View>

        {/* Pending Validations */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Pending Validations
              {stats.pendingCount > 0 && (
                <Text style={styles.countBadge}> ({stats.pendingCount})</Text>
              )}
            </Text>
            {pendingLogs.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/(advisor)/validation')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            )}
          </View>

          {pendingLogs.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="shield-checkmark" size={40} color={colors.success} />
              <Text style={styles.emptyTitle}>All validated!</Text>
              <Text style={styles.emptyText}>No pending validations at the moment.</Text>
            </View>
          ) : (
            pendingLogs.map((log) => (
              <TouchableOpacity
                key={log.id}
                style={styles.pendingCard}
                onPress={() => router.push('/(advisor)/validation')}
                activeOpacity={0.7}
              >
                <View style={styles.pendingLeft}>
                  <View style={styles.pendingAvatar}>
                    <Text style={styles.pendingInitials}>
                      {getInitials(log.studentFirstName, log.studentLastName)}
                    </Text>
                  </View>
                  <View style={styles.pendingInfo}>
                    <Text style={styles.pendingStudent} numberOfLines={1}>
                      {log.studentFirstName} {log.studentLastName}
                    </Text>
                    <Text style={styles.pendingTitle} numberOfLines={1}>{log.title}</Text>
                    <View style={styles.pendingMeta}>
                      <Text style={styles.pendingDate}>
                        {new Date(log.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                      {log.mentorRating > 0 && (
                        <View style={styles.ratingBadge}>
                          <Ionicons name="star" size={10} color={colors.gamification.gold} />
                          <Text style={styles.ratingText}>{log.mentorRating}/5</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
                <View style={styles.pendingRight}>
                  <Text style={styles.waitTime}>{getWaitTime(log.createdAt)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Student Overview */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Student Overview</Text>
            {students.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/(advisor)/student-monitor')}>
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
                onPress={() => router.push('/(advisor)/student-monitor')}
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
                  {student.companyName && (
                    <Text style={styles.companyName} numberOfLines={1}>{student.companyName}</Text>
                  )}
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
                        <Text style={styles.metaText}>{student.currentStreak}d</Text>
                      </View>
                    )}
                    <View style={styles.metaItem}>
                      <Ionicons name="pie-chart" size={13} color={colors.info} />
                      <Text style={styles.metaText}>{student.completionPct}%</Text>
                    </View>
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
  pendingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 3,
  },
  pendingDate: {
    fontSize: 11,
    color: colors.textDisabled,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.gamification.gold + '15',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  ratingText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.gamification.gold,
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
  companyName: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
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
