import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useAdminStore } from '@/store/adminStore';
import { adminService } from '@/services/admin';
import { StatCard } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';

const ADMIN_COLOR = '#e65100';

interface ReportsData {
  totalStudents: number;
  activeInternships: number;
  totalAdvisors: number;
  completionRate: number;
  roleBreakdown: {
    students: number;
    advisors: number;
    mentors: number;
  };
}

export default function AdminReportsScreen() {
  const user = useAuthStore((s) => s.user);
  const { institution } = useAdminStore();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<ReportsData | null>(null);

  const loadData = useCallback(async () => {
    if (!institution) {
      setLoading(false);
      return;
    }
    try {
      const result = await adminService.getInstitutionReports(institution.id);
      setData(result);
    } catch (err) {
      console.error('Reports load error:', err);
    } finally {
      setLoading(false);
    }
  }, [institution]);

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

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ADMIN_COLOR} />
        </View>
      </SafeAreaView>
    );
  }

  const roleItems = [
    { key: 'students', label: 'Students', color: colors.primary, icon: 'school' as const },
    { key: 'advisors', label: 'Advisors', color: colors.info, icon: 'clipboard' as const },
    { key: 'mentors', label: 'Mentors', color: colors.secondary, icon: 'people' as const },
  ];

  const totalMembers = data
    ? data.roleBreakdown.students + data.roleBreakdown.advisors + data.roleBreakdown.mentors
    : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADMIN_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>Reports & Analytics</Text>

        {!institution ? (
          <View style={styles.emptyCard}>
            <Ionicons name="business-outline" size={48} color={colors.textDisabled} />
            <Text style={styles.emptyText}>
              Create an institution from the dashboard to see reports.
            </Text>
          </View>
        ) : (
          <>
            {/* Summary Stats */}
            <View style={styles.statsGrid}>
              <View style={styles.statsRow}>
                <StatCard
                  title="Total Students"
                  value={data?.totalStudents || 0}
                  icon="people"
                  color={ADMIN_COLOR}
                />
                <View style={{ width: spacing.sm }} />
                <StatCard
                  title="Active Internships"
                  value={data?.activeInternships || 0}
                  icon="briefcase"
                  color={colors.success}
                />
              </View>
              <View style={styles.statsRow}>
                <StatCard
                  title="Total Advisors"
                  value={data?.totalAdvisors || 0}
                  icon="school"
                  color={colors.info}
                />
                <View style={{ width: spacing.sm }} />
                <StatCard
                  title="Completion Rate"
                  value={`${data?.completionRate || 0}%`}
                  icon="trending-up"
                  color={colors.warning}
                />
              </View>
            </View>

            {/* Role Breakdown */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Member Breakdown</Text>
              <View style={styles.breakdownCard}>
                {/* Color bar */}
                {totalMembers > 0 && (
                  <View style={styles.statusBar}>
                    {roleItems.map(({ key, color }) => {
                      const count = data?.roleBreakdown[key as keyof typeof data.roleBreakdown] || 0;
                      const pct = (count / totalMembers) * 100;
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
                {roleItems.map(({ key, label, color, icon }) => {
                  const count = data?.roleBreakdown[key as keyof typeof data.roleBreakdown] || 0;
                  return (
                    <View key={key} style={styles.legendRow}>
                      <View style={styles.legendLeft}>
                        <View style={[styles.legendDot, { backgroundColor: color }]} />
                        <Ionicons name={icon} size={16} color={color} />
                        <Text style={styles.legendLabel}>{label}</Text>
                      </View>
                      <Text style={styles.legendValue}>{count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Institution Info */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Institution Info</Text>
              <View style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Name</Text>
                  <Text style={styles.infoValue}>{institution.name}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Type</Text>
                  <Text style={styles.infoValue}>
                    {institution.type === 'university'
                      ? 'University'
                      : institution.type === 'vocational_school'
                        ? 'Vocational School'
                        : 'Other'}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Country</Text>
                  <Text style={styles.infoValue}>{institution.country || '-'}</Text>
                </View>
                <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.infoLabel}>Institution Code</Text>
                  <Text style={[styles.infoValue, { color: ADMIN_COLOR, fontWeight: '700' }]}>
                    {institution.institutionCode}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

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
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
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

  // Info card
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  infoRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 15,
    color: colors.text,
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
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
