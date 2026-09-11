import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { notificationService } from '@/services/notifications';
import { StatCard, LoadFailedBanner } from '@/components/common';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
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

function mapStudent(row: Record<string, unknown>): StudentItem {
  const profile = row.profiles as Record<string, unknown> | null;
  // Competency attainment, computed once in the service so this screen and
  // the reports screen quote the same number for the same student.
  const completionPct = (row.completionPercent as number) || 0;
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

export default function AdvisorDashboard() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    assignedCount: 0,
    avgCompletion: 0,
  });
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [inactiveStudents, setInactiveStudents] = useState<{
    id: string;
    firstName: string;
    lastName: string;
    daysSinceLastSubmission: number | null;
  }[]>([]);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoadFailed(false);
    try {
      const result = await advisorService.getDashboardStats(user.id);
      setStats({
        assignedCount: result.assignedCount,
        avgCompletion: result.avgCompletion,
      });
      setStudents(
        (result.students || []).slice(0, 5).map((s) => mapStudent(s as unknown as Record<string, unknown>)),
      );

      // Load inactive students
      try {
        const inactive = await advisorService.getInactiveStudents(user.id);
        setInactiveStudents(inactive);
      } catch {
        setInactiveStudents([]);
      }
    } catch (err) {
      console.error('Advisor dashboard load error:', err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // Realtime: auto-refresh when students submit work. This used to listen on
  // daily_logs -- a table nothing writes to any more, so the screen refreshed
  // on nothing and stayed stale when real work arrived.
  useRealtimeSubscription({
    table: 'assignment_submissions',
    event: '*',
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

  const handleSendReminder = async (studentId: string, studentName: string) => {
    if (!user) return;
    const advisorName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Your advisor';
    try {
      await notificationService.create(
        studentId,
        t('advisor.reminderTitle'),
        t('advisor.reminderBody', { advisor: advisorName }),
        'general',
        {},
      );
      Alert.alert('Sent', `Reminder sent to ${studentName}.`);
    } catch (err) {
      console.warn('Reminder notification failed:', err);
      Alert.alert('Error', 'Failed to send reminder.');
    }
  };

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

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
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting} numberOfLines={1}>
              Hello, {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Advisor'}
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
              title="Avg Completion"
              value={`${stats.avgCompletion}%`}
              icon="trending-up"
              color={colors.info}
            />
          </View>
        </View>

        {/* Intervention Alerts */}
        {inactiveStudents.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Intervention Alerts
                <Text style={styles.alertCountBadge}> ({inactiveStudents.length})</Text>
              </Text>
            </View>
            {inactiveStudents.map((student) => (
              <View key={student.id} style={styles.alertCard}>
                <View style={styles.alertIconWrap}>
                  <Ionicons name="alert-circle" size={24} color={colors.error} />
                </View>
                <View style={styles.alertInfo}>
                  <Text style={styles.alertName}>
                    {student.firstName} {student.lastName}
                  </Text>
                  <Text style={styles.alertDesc}>
                    {student.daysSinceLastSubmission === null
                      ? t('advisor.noSubmissionsYet')
                      : t('advisor.daysSinceLastSubmission', {
                          count: student.daysSinceLastSubmission,
                        })}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.reminderBtn}
                  onPress={() =>
                    handleSendReminder(student.id, `${student.firstName} ${student.lastName}`)
                  }
                  activeOpacity={0.7}
                >
                  <Ionicons name="notifications-outline" size={16} color="#fff" />
                  <Text style={styles.reminderBtnText}>Remind</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

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
                        <Text style={styles.metaText}>{student.currentStreak}w</Text>
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
  seeAll: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },

  // Intervention Alerts
  alertCountBadge: {
    color: colors.error,
    fontWeight: '700',
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error + '08',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
  },
  alertIconWrap: {
    marginRight: spacing.sm,
  },
  alertInfo: {
    flex: 1,
  },
  alertName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  alertDesc: {
    fontSize: 12,
    color: colors.error,
    marginTop: 2,
    fontWeight: '500',
  },
  reminderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.sm,
  },
  reminderBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
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
