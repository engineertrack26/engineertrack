import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Share,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { StatCard, ProgressBar } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';

interface StudentProgress {
  id: string;
  firstName: string;
  lastName: string;
  totalLogs: number;
  xp: number;
  level: number;
  completionPct: number;
}

interface ReportsData {
  totalStudents: number;
  totalLogs: number;
  approvedRate: number;
  avgMentorScore: number;
  studentProgress: StudentProgress[];
  statusBreakdown: {
    draft: number;
    submitted: number;
    approved: number;
    validated: number;
    needs_revision: number;
  };
}

const STATUS_CONFIG = [
  { key: 'draft', label: 'Draft', color: colors.status.draft },
  { key: 'submitted', label: 'Submitted', color: colors.status.submitted },
  { key: 'approved', label: 'Approved', color: colors.status.approved },
  { key: 'validated', label: 'Validated', color: colors.status.validated },
  { key: 'needs_revision', label: 'Needs Revision', color: colors.status.needsRevision },
] as const;

export default function ReportsScreen() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<ReportsData | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const result = await advisorService.getReportsData(user.id);
      setData(result);
    } catch (err) {
      console.error('Reports load error:', err);
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

  const handleExportCSV = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const lines: string[] = [];

      // Summary section
      lines.push('SUMMARY');
      lines.push('Total Students,Total Logs,Approved Rate (%),Avg Mentor Score');
      lines.push(
        `${data.totalStudents},${data.totalLogs},${data.approvedRate},${data.avgMentorScore ? data.avgMentorScore.toFixed(1) : ''}`,
      );
      lines.push('');

      // Status breakdown section
      lines.push('LOG STATUS BREAKDOWN');
      lines.push('Status,Count');
      STATUS_CONFIG.forEach(({ key, label }) => {
        const count = data.statusBreakdown[key as keyof typeof data.statusBreakdown] || 0;
        lines.push(`${label},${count}`);
      });
      lines.push('');

      // Student progress section
      lines.push('STUDENT PROGRESS');
      lines.push('Name,Total Logs,XP,Level,Completion (%)');
      data.studentProgress.forEach((s) => {
        const name = `${s.firstName} ${s.lastName}`.replace(/,/g, ' ');
        lines.push(`${name},${s.totalLogs},${s.xp},${s.level},${s.completionPct}`);
      });

      const csvContent = lines.join('\n');

      await Share.share({
        message: csvContent,
        title: 'InternTrack Reports',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      Alert.alert('Export Error', msg);
    } finally {
      setExporting(false);
    }
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

  const totalByStatus = data
    ? Object.values(data.statusBreakdown).reduce((a, b) => a + b, 0)
    : 0;

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
        <View style={styles.titleRow}>
          <Text style={styles.screenTitle}>Reports & Analytics</Text>
          <TouchableOpacity
            style={[styles.exportBtn, exporting && { opacity: 0.6 }]}
            onPress={handleExportCSV}
            disabled={exporting || !data}
            activeOpacity={0.7}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Ionicons name="share-outline" size={18} color={colors.primary} />
                <Text style={styles.exportBtnText}>Export</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Summary Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard
              title="Total Students"
              value={data?.totalStudents || 0}
              icon="people"
              color={colors.primary}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title="Total Logs"
              value={data?.totalLogs || 0}
              icon="document-text"
              color={colors.info}
            />
          </View>
          <View style={styles.statsRow}>
            <StatCard
              title="Approved Rate"
              value={`${data?.approvedRate || 0}%`}
              icon="checkmark-done"
              color={colors.success}
            />
            <View style={{ width: spacing.sm }} />
            <StatCard
              title="Avg Mentor Score"
              value={data?.avgMentorScore ? data.avgMentorScore.toFixed(1) : '-'}
              icon="star"
              color={colors.gamification.gold}
            />
          </View>
        </View>

        {/* Log Status Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Log Status Breakdown</Text>
          <View style={styles.breakdownCard}>
            {/* Color bar */}
            {totalByStatus > 0 && (
              <View style={styles.statusBar}>
                {STATUS_CONFIG.map(({ key, color }) => {
                  const count = data?.statusBreakdown[key as keyof typeof data.statusBreakdown] || 0;
                  const pct = (count / totalByStatus) * 100;
                  if (pct === 0) return null;
                  return (
                    <View
                      key={key}
                      style={[styles.statusBarSegment, { width: `${pct}%`, backgroundColor: color }]}
                    />
                  );
                })}
              </View>
            )}

            {/* Legend */}
            {STATUS_CONFIG.map(({ key, label, color }) => {
              const count = data?.statusBreakdown[key as keyof typeof data.statusBreakdown] || 0;
              return (
                <View key={key} style={styles.legendRow}>
                  <View style={styles.legendLeft}>
                    <View style={[styles.legendDot, { backgroundColor: color }]} />
                    <Text style={styles.legendLabel}>{label}</Text>
                  </View>
                  <Text style={styles.legendValue}>{count}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Student Completion Overview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Student Completion</Text>
          {(data?.studentProgress || []).length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={40} color={colors.textDisabled} />
              <Text style={styles.emptyText}>No students assigned yet.</Text>
            </View>
          ) : (
            data!.studentProgress.map((student) => (
              <View key={student.id} style={styles.studentCard}>
                <View style={styles.studentTop}>
                  <View style={styles.studentAvatar}>
                    <Text style={styles.studentInitials}>
                      {getInitials(student.firstName, student.lastName)}
                    </Text>
                  </View>
                  <View style={styles.studentInfo}>
                    <Text style={styles.studentName} numberOfLines={1}>
                      {student.firstName} {student.lastName}
                    </Text>
                    <View style={styles.studentStats}>
                      <Text style={styles.studentStat}>{student.totalLogs} logs</Text>
                      <Text style={styles.studentStatDot}> </Text>
                      <Text style={styles.studentStat}>{student.xp} XP</Text>
                      <Text style={styles.studentStatDot}> </Text>
                      <Text style={styles.studentStat}>Lvl {student.level}</Text>
                    </View>
                  </View>
                  <Text style={styles.completionPct}>{student.completionPct}%</Text>
                </View>
                <ProgressBar
                  progress={student.completionPct / 100}
                  color={student.completionPct >= 80 ? colors.success : student.completionPct >= 50 ? colors.warning : colors.error}
                  height={6}
                />
              </View>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
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
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },

  // Breakdown card
  breakdownCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  statusBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  statusBarSegment: {
    height: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
  },
  legendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  legendValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },

  // Student cards
  studentCard: {
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
  studentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  studentAvatar: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  studentInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  studentStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  studentStat: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  studentStatDot: {
    fontSize: 12,
    color: colors.textDisabled,
    marginHorizontal: 4,
  },
  completionPct: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    marginLeft: spacing.sm,
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
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
});
