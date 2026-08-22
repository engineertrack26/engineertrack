import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { assignmentService } from '@/services/assignments';
import { groupService } from '@/services/group';
import { logService } from '@/services/logs';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { groupAssignmentsByState } from '@/utils/assignmentGrouping';
import { colors, spacing, borderRadius } from '@/theme';
import type { MyAssignment } from '@/types/assignment';
import type { GroupSummary } from '@/types/group';

type SectionKey = 'revise' | 'todo' | 'waiting' | 'done';

// What the mentor sent back is the most urgent thing on the screen, so it
// leads. A student cannot act on 'waiting' or 'done' items -- those are
// read-only until the mentor moves them.
const SECTIONS: { key: SectionKey; titleKey: string; color: string; actionable: boolean }[] = [
  { key: 'revise', titleKey: 'student.stateRevise', color: colors.status.needsRevision, actionable: true },
  { key: 'todo', titleKey: 'student.stateTodo', color: colors.status.draft, actionable: true },
  { key: 'waiting', titleKey: 'student.stateWaiting', color: colors.status.submitted, actionable: false },
  { key: 'done', titleKey: 'student.stateDone', color: colors.status.approved, actionable: false },
];

function todayIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export default function MyTasksScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [todayLog, setTodayLog] = useState<{ id: string; title: string } | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [attachLog, setAttachLog] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      // listMyAssignments needs a group id, so the student's group has to be
      // resolved first. A student in no group is a normal state, not an
      // error -- there is simply nothing to show.
      const g = await groupService.getMyGroup(user.id);
      setGroup(g);
      if (!g) {
        setAssignments([]);
        setTodayLog(null);
        return;
      }
      const [items, todayData] = await Promise.all([
        assignmentService.listMyAssignments(g.id, user.id),
        logService.getLogByDate(user.id, todayIso()),
      ]);
      setAssignments(items);
      setTodayLog(
        todayData
          ? { id: (todayData.id as string) || '', title: (todayData.title as string) || '' }
          : null,
      );
    } catch (err) {
      console.error('My tasks load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const groups = useMemo(() => groupAssignmentsByState(assignments), [assignments]);

  function toggleOpen(a: MyAssignment) {
    if (openId === a.id) {
      setOpenId(null);
      return;
    }
    setOpenId(a.id);
    setNote('');
    setAttachLog(false);
  }

  async function handleSubmit(a: MyAssignment) {
    setSubmitting(true);
    try {
      await assignmentService.submitAssignment(
        a.id,
        note.trim(),
        attachLog && todayLog ? todayLog.id : null,
      );
      Alert.alert(t('common.done'), t('student.taskSubmitted'));
      setOpenId(null);
      setNote('');
      setAttachLog(false);
      await loadData();
    } catch (err) {
      // ALREADY_APPROVED is the one a student will actually hit -- tapping
      // Submit on a task their mentor approved while this screen was open.
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSubmitting(false);
    }
  }

  function renderCard(a: MyAssignment, color: string, actionable: boolean) {
    const isOpen = openId === a.id;
    return (
      <View key={a.id} style={[styles.card, { borderLeftColor: color }]}>
        <TouchableOpacity
          style={styles.cardHeaderRow}
          onPress={() => toggleOpen(a)}
          activeOpacity={0.7}
        >
          <Text style={styles.cardTitle}>{a.title}</Text>
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        {isOpen && (
          <View style={styles.detail}>
            <Text style={styles.label}>{t('student.taskObjective')}</Text>
            <Text style={styles.detailText}>{a.objective}</Text>

            <Text style={styles.label}>{t('student.taskCriterion')}</Text>
            <Text style={styles.detailText}>{a.criterion}</Text>

            {!!a.submission?.mentorNote && (
              <>
                <Text style={styles.label}>{t('mentor.comments')}</Text>
                <Text style={styles.detailText}>{a.submission.mentorNote}</Text>
              </>
            )}

            {actionable && (
              <>
                <Text style={styles.label}>{t('student.taskNote')}</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholderTextColor={colors.textDisabled}
                />

                {todayLog && (
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel} numberOfLines={2}>
                      {t('student.attachTodaysLog', { title: todayLog.title })}
                    </Text>
                    <Switch
                      value={attachLog}
                      onValueChange={setAttachLog}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>
                )}

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => handleSubmit(a)}
                  disabled={submitting}
                  activeOpacity={0.7}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>{t('student.submitTask')}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <Text style={styles.screenTitle}>{t('student.myTasks')}</Text>

        {!group && (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color={colors.textDisabled} />
            <Text style={styles.emptyText}>{t('student.noGroupTasks')}</Text>
          </View>
        )}

        {!!group && assignments.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="clipboard-outline" size={48} color={colors.textDisabled} />
            <Text style={styles.emptyText}>{t('student.noTasks')}</Text>
          </View>
        )}

        {!!group && assignments.length > 0 && SECTIONS.map((section) => {
          const items = groups[section.key];
          if (items.length === 0) return null;
          return (
            <View key={section.key} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: section.color }]}>
                {t(section.titleKey)} ({items.length})
              </Text>
              {items.map((a) => renderCard(a, section.color, section.actionable))}
            </View>
          );
        })}

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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },

  detail: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  detailText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  toggleLabel: {
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },

  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
