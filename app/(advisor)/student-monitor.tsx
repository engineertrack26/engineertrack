import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { ProgressBar } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';

interface StudentMonitorItem {
  id: string;
  firstName: string;
  lastName: string;
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
  companyName?: string;
  internshipStartDate?: string;
  internshipEndDate?: string;
  completionPct: number;
  daysCurrent: number;
  daysTotal: number;
}

function mapStudent(row: Record<string, unknown>): StudentMonitorItem {
  const profile = row.profiles as Record<string, unknown> | null;
  const start = row.internship_start_date as string | null;
  const end = row.internship_end_date as string | null;
  let completionPct = 0;
  let daysCurrent = 0;
  let daysTotal = 0;
  if (start && end) {
    const startDate = new Date(start).getTime();
    const endDate = new Date(end).getTime();
    const total = endDate - startDate;
    const msPerDay = 1000 * 60 * 60 * 24;
    daysTotal = Math.ceil(total / msPerDay);
    daysCurrent = Math.min(daysTotal, Math.max(0, Math.ceil((Date.now() - startDate) / msPerDay)));
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
    internshipStartDate: start || undefined,
    internshipEndDate: end || undefined,
    completionPct,
    daysCurrent,
    daysTotal,
  };
}

export default function StudentMonitorScreen() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [students, setStudents] = useState<StudentMonitorItem[]>([]);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const data = await advisorService.getAssignedStudents(user.id);
      setStudents(
        (data || []).map((s) => mapStudent(s as unknown as Record<string, unknown>)),
      );
    } catch (err) {
      console.error('Student monitor load error:', err);
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

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const renderItem = ({ item }: { item: StudentMonitorItem }) => (
    <View style={styles.card}>
      {/* Top row: avatar + name + company */}
      <View style={styles.cardTop}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>
            {getInitials(item.firstName, item.lastName)}
          </Text>
        </View>
        <View style={styles.nameSection}>
          <Text style={styles.studentName} numberOfLines={1}>
            {item.firstName} {item.lastName}
          </Text>
          {item.companyName && (
            <Text style={styles.companyName} numberOfLines={1}>{item.companyName}</Text>
          )}
        </View>
        <View style={styles.levelBadge}>
          <Text style={styles.levelText}>Lvl {item.currentLevel}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressSection}>
        <View style={styles.progressLabel}>
          <Text style={styles.progressLabelText}>Internship Progress</Text>
          <Text style={styles.progressDays}>
            Day {item.daysCurrent}/{item.daysTotal}
          </Text>
        </View>
        <ProgressBar
          progress={item.completionPct / 100}
          color={colors.primary}
          height={8}
        />
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Ionicons name="flash" size={14} color={colors.gamification.xp} />
          <Text style={styles.statValue}>{item.totalXp}</Text>
          <Text style={styles.statLabel}>XP</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Ionicons name="flame" size={14} color={colors.gamification.streak} />
          <Text style={styles.statValue}>{item.currentStreak}</Text>
          <Text style={styles.statLabel}>Streak</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Ionicons name="pie-chart" size={14} color={colors.info} />
          <Text style={styles.statValue}>{item.completionPct}%</Text>
          <Text style={styles.statLabel}>Done</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerContainer}>
        <Text style={styles.screenTitle}>Student Monitor</Text>
        <Text style={styles.countText}>{students.length} student{students.length !== 1 ? 's' : ''}</Text>
      </View>

      <FlatList
        data={students}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
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
    color: colors.primary,
    fontWeight: '600',
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
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  initials: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  nameSection: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  companyName: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  levelBadge: {
    backgroundColor: colors.gamification.levelUp + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    marginLeft: spacing.sm,
  },
  levelText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gamification.levelUp,
  },

  // Progress
  progressSection: {
    marginBottom: spacing.sm,
  },
  progressLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  progressLabelText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  progressDays: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
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
