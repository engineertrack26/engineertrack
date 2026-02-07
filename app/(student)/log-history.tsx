import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useLogStore } from '@/store/logStore';
import { logService } from '@/services/logs';
import { LogCard } from '@/components/cards';
import { DailyLog, LogStatus } from '@/types/log';
import { colors, spacing, borderRadius } from '@/theme';

type FilterOption = 'all' | LogStatus;

const FILTERS: { key: FilterOption; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
  { key: 'needs_revision', label: 'Revision' },
  { key: 'validated', label: 'Validated' },
];

function mapDbLog(row: Record<string, unknown>): DailyLog {
  return {
    id: row.id as string,
    studentId: (row.student_id as string) || '',
    date: row.date as string,
    title: (row.title as string) || '',
    content: (row.content as string) || '',
    activitiesPerformed: (row.activities_performed as string) || '',
    skillsLearned: (row.skills_learned as string) || '',
    challengesFaced: (row.challenges_faced as string) || '',
    status: (row.status as DailyLog['status']) || 'draft',
    photos: [],
    documents: [],
    revisionHistory: [],
    xpEarned: (row.xp_earned as number) || 0,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

export default function LogHistoryScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { logs, setLogs } = useLogStore();
  const [filter, setFilter] = useState<FilterOption>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    try {
      const data = await logService.getLogsByStudent(user.id);
      setLogs((data || []).map(mapDbLog));
    } catch (err) {
      console.error('Load logs error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, setLogs]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLogs();
    setRefreshing(false);
  }, [loadLogs]);

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter((log) => log.status === filter);

  const handleLogPress = (log: DailyLog) => {
    const date = new Date(log.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    Alert.alert(
      log.title,
      `Date: ${date}\nStatus: ${log.status.replace('_', ' ')}\n\n${log.content}${
        log.xpEarned > 0 ? `\n\nXP Earned: +${log.xpEarned}` : ''
      }`,
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <Text style={styles.header}>{t('student.logHistory')}</Text>

        {/* Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContainer}
          style={styles.filterScroll}
        >
          {FILTERS.map((f) => {
            const isActive = filter === f.key;
            const count = f.key === 'all'
              ? logs.length
              : logs.filter((l) => l.status === f.key).length;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                  {f.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Log List */}
        {loading ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={filteredLogs}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <LogCard log={item} onPress={() => handleLogPress(item)} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={48} color={colors.textDisabled} />
                <Text style={styles.emptyTitle}>No logs yet</Text>
                <Text style={styles.emptyText}>
                  {filter === 'all'
                    ? 'Start by creating your first daily log'
                    : `No logs with status "${filter.replace('_', ' ')}"`}
                </Text>
              </View>
            }
          />
        )}
      </View>
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
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  filterScroll: {
    maxHeight: 44,
    marginBottom: spacing.sm,
  },
  filterContainer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
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
  },
});
