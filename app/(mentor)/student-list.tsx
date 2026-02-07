import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { mentorService } from '@/services/mentor';
import { logService } from '@/services/logs';
import { DailyLog } from '@/types/log';
import { colors, spacing, borderRadius } from '@/theme';

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

function getInternshipProgress(start?: string, end?: string): { current: number; total: number } {
  if (!start || !end) return { current: 0, total: 0 };
  const startDate = new Date(start);
  const endDate = new Date(end);
  const now = new Date();
  const total = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const current = Math.max(0, Math.min(total, Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))));
  return { current, total };
}

export default function StudentListScreen() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [students, setStudents] = useState<StudentItem[]>([]);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const data = await mentorService.getAssignedStudents(user.id);
      setStudents(
        (data || []).map((s) => mapStudent(s as unknown as Record<string, unknown>)),
      );
    } catch (err) {
      console.error('Student list load error:', err);
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

  const handleStudentPress = useCallback(async (student: StudentItem) => {
    try {
      const logs = await logService.getLogsByStudent(student.id);
      const logCount = logs?.length || 0;
      const approvedCount = (logs || []).filter(
        (l: Record<string, unknown>) => l.status === 'approved' || l.status === 'validated',
      ).length;
      const submittedCount = (logs || []).filter(
        (l: Record<string, unknown>) => l.status === 'submitted',
      ).length;

      Alert.alert(
        `${student.firstName} ${student.lastName}`,
        [
          `Total Logs: ${logCount}`,
          `Approved: ${approvedCount}`,
          `Pending Review: ${submittedCount}`,
          `XP: ${student.totalXp}`,
          `Level: ${student.currentLevel}`,
          `Streak: ${student.currentStreak} days`,
        ].join('\n'),
        [{ text: 'OK' }],
      );
    } catch {
      Alert.alert('Error', 'Failed to load student details.');
    }
  }, []);

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

  const renderStudent = ({ item }: { item: StudentItem }) => {
    const progress = getInternshipProgress(item.internshipStartDate, item.internshipEndDate);
    const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleStudentPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardTop}>
          <View style={styles.avatarContainer}>
            <Text style={styles.initials}>{getInitials(item.firstName, item.lastName)}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.studentName} numberOfLines={1}>
              {item.firstName} {item.lastName}
            </Text>
            {progress.total > 0 && (
              <Text style={styles.progressText}>
                Day {progress.current} / {progress.total}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textDisabled} />
        </View>

        {/* Progress Bar */}
        {progress.total > 0 && (
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.min(progressPercent, 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>
        )}

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="flash" size={15} color={colors.gamification.xp} />
            <Text style={styles.statValue}>{item.totalXp}</Text>
            <Text style={styles.statLabel}>XP</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="arrow-up-circle" size={15} color={colors.gamification.levelUp} />
            <Text style={styles.statValue}>{item.currentLevel}</Text>
            <Text style={styles.statLabel}>Level</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="flame" size={15} color={colors.gamification.streak} />
            <Text style={styles.statValue}>{item.currentStreak}</Text>
            <Text style={styles.statLabel}>Streak</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
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
      <View style={styles.headerContainer}>
        <Text style={styles.screenTitle}>My Students</Text>
        <Text style={styles.countText}>{students.length} student{students.length !== 1 ? 's' : ''}</Text>
      </View>

      <FlatList
        data={students}
        keyExtractor={(item) => item.id}
        renderItem={renderStudent}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={64} color={colors.textDisabled} />
            <Text style={styles.emptyTitle}>No Students Assigned</Text>
            <Text style={styles.emptyText}>
              Students will appear here once they are assigned to you.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  countText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  initials: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.primary,
  },
  cardInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  progressText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Progress Bar
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  progressBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    minWidth: 36,
    textAlign: 'right',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.divider,
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl * 2,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
