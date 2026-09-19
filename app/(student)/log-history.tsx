import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
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
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { colors, spacing, borderRadius, fonts } from '@/theme';
import { BackButton, Button, LoadFailedBanner } from '@/components/common';
import { router } from 'expo-router';

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
    hoursSpent: (row.hours_spent as number) || 0,
    status: (row.status as DailyLog['status']) || 'draft',
    photos: [],
    documents: [],
    revisionHistory: [],
    advisorNotes: (row.advisor_notes as string) || undefined,
    xpEarned: (row.xp_earned as number) || 0,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

export default function LogHistoryScreen() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { logs, setLogs } = useLogStore();
  const [filter, setFilter] = useState<FilterOption>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedLog, setSelectedLog] = useState<DailyLog | null>(null);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    setLoadFailed(false);
    try {
      const data = await logService.getLogsByStudent(user.id);
      setLogs((data || []).map(mapDbLog));
    } catch (err) {
      console.error('Load logs error:', err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [user, setLogs]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Realtime: auto-refresh when log status changes
  useRealtimeSubscription({
    table: 'daily_logs',
    filter: user ? `student_id=eq.${user.id}` : undefined,
    event: 'UPDATE',
    enabled: !!user,
    onPayload: () => {
      loadLogs();
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLogs();
    setRefreshing(false);
  }, [loadLogs]);

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter((log) => log.status === filter);

  const formatTimeSpent = (totalMinutes: number) => {
    if (totalMinutes <= 0) return '';
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <BackButton href="/(student)/dashboard" />
        <Text style={styles.header}>{t('student.pastLogs')}</Text>
        {loadFailed && <LoadFailedBanner onRetry={loadLogs} />}

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
              <LogCard log={item} onPress={() => setSelectedLog(item)} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
            ListEmptyComponent={
              !loadFailed ? <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={48} color={colors.textDisabled} />
                <Text style={styles.emptyTitle}>{t('flow.archiveEmpty')}</Text>
                <Text style={styles.emptyText}>
                  {filter === 'all'
                    ? t('flow.archiveHint')
                    : t('flow.archiveFilteredEmpty')}
                </Text>
                <Button
                  title={filter === 'all' ? t('student.myTasks') : t('flow.clearFilter')}
                  onPress={() => filter === 'all' ? router.push('/(student)/my-tasks') : setFilter('all')}
                  style={{ marginTop: spacing.md }}
                />
              </View> : null
            }
          />
        )}
      </View>
      <Modal visible={selectedLog !== null} animationType="slide" onRequestClose={() => setSelectedLog(null)}>
        <SafeAreaView style={styles.safeArea}>
          <BackButton onPress={() => setSelectedLog(null)} />
          {selectedLog && (
            <ScrollView contentContainerStyle={styles.detailContent}>
              <Text style={styles.detailTitle} accessibilityRole="header">{selectedLog.title}</Text>
              <Text style={styles.detailMeta}>
                {new Date(`${selectedLog.date}T12:00:00`).toLocaleDateString(i18n.language)}
                {' · '}{selectedLog.status.replace(/_/g, ' ')}
                {selectedLog.hoursSpent > 0 ? ` · ${formatTimeSpent(selectedLog.hoursSpent)}` : ''}
                {selectedLog.xpEarned > 0 ? ` · +${selectedLog.xpEarned} XP` : ''}
              </Text>
              {[
                ['student.content', selectedLog.content],
                ['student.activitiesPerformed', selectedLog.activitiesPerformed],
                ['student.skillsLearned', selectedLog.skillsLearned],
                ['student.challengesFaced', selectedLog.challengesFaced],
                ['flow.advisorNotes', selectedLog.advisorNotes],
              ].map(([key, content]) => content ? (
                <View key={key} style={styles.detailSection}>
                  <Text style={styles.detailLabel} accessibilityRole="header">{t(key!)}</Text>
                  <Text style={styles.detailBody} selectable>{content}</Text>
                </View>
              ) : null)}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  detailContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  detailTitle: { fontSize: 24, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text },
  detailMeta: { fontSize: 14, fontFamily: fonts.regular, lineHeight: 22, color: colors.textSecondary, marginTop: spacing.sm },
  detailSection: { marginTop: spacing.lg },
  detailLabel: { fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text, marginBottom: spacing.sm },
  detailBody: { fontSize: 16, fontFamily: fonts.regular, lineHeight: 24, color: colors.text },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  header: {
    fontSize: 24,
    fontWeight: '600', fontFamily: fonts.semibold,
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
    fontWeight: '500', fontFamily: fonts.medium,
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
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyText: {
    fontSize: 14, fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
