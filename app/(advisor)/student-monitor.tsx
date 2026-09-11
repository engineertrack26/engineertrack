import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useGroupStore } from '@/store/groupStore';
import { advisorService } from '@/services/advisor';
import { groupService } from '@/services/group';
import { BackButton, ProgressBar, LoadFailedBanner } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';
import type { GroupMember } from '@/types/group';

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
  /** Both `null` together when the internship span is unknown: a missing or
   *  unusable date is not day zero, so the counter is not rendered at all. */
  daysCurrent: number | null;
  daysTotal: number | null;
}

/** A `YYYY-MM-DD` date at the device's local midnight. `Date.parse` on the bare
 *  string would give UTC midnight, which is a different calendar day for part
 *  of every day anywhere but UTC. NaN for anything that is not a plain date. */
function localMidnight(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return Number.NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function mapStudent(row: Record<string, unknown>): StudentMonitorItem {
  const profile = row.profiles as Record<string, unknown> | null;
  // Competency attainment, straight off the service row -- the same number
  // the advisor's dashboard and reports screen quote for this student. It was
  // recomputed here from `submitted_days`, which getDashboardStats stopped
  // returning when the daily log was retired; the Record<string, unknown>
  // cast hid that from tsc, so this silently read 0 for everyone.
  const completionPct = (row.completionPercent as number) || 0;
  const start = row.internship_start_date as string | null;
  const end = row.internship_end_date as string | null;
  // Elapsed calendar days of the internship, which is what "Day 12 of 60"
  // has always claimed to mean. It used to be driven by `submitted_days`, so
  // it was really an attendance count wearing a calendar's label, and once
  // that field went it read "Day 0" for everyone -- including a student two
  // months in. Nothing here is submission-derived; both dates come off the
  // row `getAssignedStudents` already selects.
  const msPerDay = 1000 * 60 * 60 * 24;
  let daysCurrent: number | null = null;
  let daysTotal: number | null = null;
  if (start && end) {
    // Both columns are Postgres `date`s. `new Date('2026-09-11')` would anchor
    // them at UTC midnight while `Date.now()` is the device's absolute instant,
    // which puts the counter a day out for part of every local day on any
    // device not on UTC. Work in local calendar days instead: each date at the
    // device's local midnight, today at the device's local midnight, and the
    // difference rounded (not floored) so a DST hour cannot shave a day off.
    const startDate = localMidnight(start);
    const endDate = localMidnight(end);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const span = Math.round((endDate - startDate) / msPerDay);
    // An unparseable date gives NaN, and an end on or before the start gives
    // a span of zero or less. Neither is a span we can honestly count within,
    // so both leave the counter unrendered rather than showing "Day 0/0".
    if (Number.isFinite(span) && span > 0) {
      daysTotal = span;
      // Day one is the start date itself, so +1. Clamped at both ends: an
      // internship that has not started yet is day 0 rather than a negative
      // number, and one that has run past its end date reads "Day 60/60"
      // rather than "Day 71/60".
      const elapsed = Math.round((today.getTime() - startDate) / msPerDay) + 1;
      daysCurrent = Math.max(0, Math.min(span, elapsed));
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
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const groups = useGroupStore((s) => s.groups);
  const fetchGroups = useGroupStore((s) => s.fetchGroups);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [students, setStudents] = useState<StudentMonitorItem[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);

  const activeGroup = groupId ? groups.find((g) => g.id === groupId) : undefined;

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoadFailed(false);
    try {
      if (groupId) {
        const [groupMembers] = await Promise.all([
          groupService.listMembers(groupId),
          groups.length === 0 ? fetchGroups(user.id) : Promise.resolve(),
        ]);
        setMembers(groupMembers);
      } else {
        const result = await advisorService.getDashboardStats(user.id);
        setStudents(
          (result.students || []).map((s) => mapStudent(s as unknown as Record<string, unknown>)),
        );
      }
    } catch (err) {
      console.error('Student monitor load error:', err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [user, groupId, groups.length, fetchGroups]);

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

  function confirmRemove(member: GroupMember) {
    const name = `${member.firstName} ${member.lastName}`.trim();
    Alert.alert(
      t('advisor.removeStudent'),
      t('advisor.removeStudentConfirm', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('advisor.removeStudent'),
          style: 'destructive',
          onPress: async () => {
            try {
              await groupService.closeMembership(member.membershipId);
              await loadData();
              Alert.alert(t('advisor.removeStudent'), t('advisor.removeStudentDone'));
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.unknown'));
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <BackButton href={groupId ? '/(advisor)/groups' : '/(advisor)/dashboard'} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (groupId) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <BackButton href="/(advisor)/groups" />
          <Text style={styles.screenTitle}>
            {activeGroup?.name || t('advisor.studentMonitor')}
          </Text>
          <Text style={styles.countText}>{t('advisor.memberCount', { count: members.length })}</Text>
        </View>

        <FlatList
          data={members}
          keyExtractor={(item) => item.membershipId}
          renderItem={({ item }) => (
            <View style={styles.memberCard}>
              <View style={styles.avatar}>
                <Text style={styles.initials}>
                  {getInitials(item.firstName, item.lastName)}
                </Text>
              </View>
              <View style={styles.nameSection}>
                <Text style={styles.studentName} numberOfLines={1}>
                  {item.firstName} {item.lastName}
                </Text>
                <Text style={styles.companyName} numberOfLines={1}>{item.email}</Text>
              </View>
              <TouchableOpacity
                onPress={() => confirmRemove(item)}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Ionicons name="person-remove-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={64} color={colors.textDisabled} />
              <Text style={styles.emptyTitle}>{t('advisor.noStudentsYet')}</Text>
              <Text style={styles.emptyText}>
                {t('advisor.noStudentsYetHint')}
              </Text>
            </View>
          }
          ListHeaderComponent={loadFailed ? <LoadFailedBanner onRetry={loadData} /> : null}
        />
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
          {item.daysCurrent !== null && item.daysTotal !== null && (
            <Text style={styles.progressDays}>
              {t('advisor.internshipDay', {
                current: item.daysCurrent,
                total: item.daysTotal,
              })}
            </Text>
          )}
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
        <BackButton href="/(advisor)/dashboard" />
        <Text style={styles.screenTitle}>{t('advisor.studentMonitor')}</Text>
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
        ListHeaderComponent={loadFailed ? <LoadFailedBanner onRetry={loadData} /> : null}
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
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
    marginRight: spacing.sm,
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

  // Group member card
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
