import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { assignmentService } from '@/services/assignments';
import { groupService } from '@/services/group';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { groupAssignmentsByState } from '@/utils/assignmentGrouping';
import { EvidencePicker } from '@/components/forms';
import { colors, spacing, borderRadius } from '@/theme';
import type { MyAssignment, PhotoEvidence, DocumentEvidence } from '@/types/assignment';
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

// due_date is a DATE column the app carries as a 'YYYY-MM-DD' string, and
// new Date('2026-09-01') is parsed as UTC and rendered locally, which in a
// negative offset shows the previous day. Parse the parts in local time
// instead, the same way the advisor's and mentor's screens do.
function fromIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function MyTasksScreen() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reflection, setReflection] = useState('');
  const [photos, setPhotos] = useState<PhotoEvidence[]>([]);
  const [documents, setDocuments] = useState<DocumentEvidence[]>([]);
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
        return;
      }
      const items = await assignmentService.listMyAssignments(g.id, user.id);
      setAssignments(items);
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

  async function openDocument(uri: string) {
    try {
      await Linking.openURL(uri);
    } catch (err) {
      console.error('Open document error:', err);
      Alert.alert(t('common.error'), t('common.tryAgain'));
    }
  }

  function toggleOpen(a: MyAssignment) {
    if (openId === a.id) {
      setOpenId(null);
      setNote('');
      setReflection('');
      setPhotos([]);
      setDocuments([]);
      return;
    }
    setOpenId(a.id);
    // Prefill all four rather than blank. submit_assignment's DO UPDATE
    // overwrites student_note and reflection unconditionally, and it deletes
    // and REWRITES the evidence rather than appending -- so a student asked
    // only to add one photo, who finds the rest blank, resubmits and destroys
    // the note and attachments they already had. Nothing errors; the mentor's
    // panel simply renders empty where content used to be.
    setNote(a.submission?.studentNote || '');
    setReflection(a.submission?.reflection || '');
    setPhotos(a.submission?.photos || []);
    setDocuments(a.submission?.documents || []);
  }

  async function handleSubmit(a: MyAssignment) {
    if (!user) return;
    setSubmitting(true);
    try {
      await assignmentService.submitAssignment(
        a.id, note.trim(), reflection.trim(), photos, documents,
      );

      // The mentor's notification is written by submit_assignment itself, not
      // from here. The only INSERT policy on notifications admits the recipient,
      // their mentor or their advisor -- a student writing to their MENTOR
      // matches none of the three, so this call raised 42501 every time and the
      // .catch around it hid that. The RPC is SECURITY DEFINER and inserts on
      // the student's behalf. It is also the sole notifier now: two attempts,
      // one of them impossible, is worse than one that works.

      Alert.alert(t('common.done'), t('student.taskSubmitted'));
      setOpenId(null);
      setNote('');
      setReflection('');
      setPhotos([]);
      setDocuments([]);
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
    const due = a.dueDate ? fromIsoDate(a.dueDate) : null;
    return (
      <View key={a.id} style={[styles.card, { borderLeftColor: color }]}>
        <TouchableOpacity
          style={styles.cardHeaderRow}
          onPress={() => toggleOpen(a)}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderText}>
            {!!a.competencyName && (
              <Text style={styles.competencyLine}>
                {a.competencyName}{a.level ? ` · L${a.level}` : ''}
              </Text>
            )}
            <Text style={styles.cardTitle}>{a.title}</Text>
            {/* The advisor sets this to tell the STUDENT when the work is due,
                and until now it reached the advisor's card and the mentor's
                and stopped there. */}
            {!!due && (
              <Text style={styles.subtle}>
                {t('student.taskDueDate')}: {due.toLocaleDateString(i18n.language)}
              </Text>
            )}
          </View>
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        {isOpen && (
          <View style={styles.detail}>
            {/* The advisor's own words about this task. "Description
                (optional)" under a title reads as "the instructions go here",
                and until now nothing but the advisor's own card ever showed
                them back. */}
            {!!a.description && (
              <Text style={[styles.detailText, styles.description]}>{a.description}</Text>
            )}

            {/* Nothing renders here at all when there is no document -- a bare
                "Brief" heading with nothing under it reads as a failed load,
                the same defect already flagged once on this branch. */}
            {!!a.documentName && (
              <>
                <Text style={styles.label}>{t('student.taskDocument')}</Text>
                <TouchableOpacity
                  style={styles.docRow}
                  onPress={() => a.documentUrl && openDocument(a.documentUrl)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="document-outline" size={18} color={colors.primary} />
                  <Text style={styles.docName} numberOfLines={1}>{a.documentName}</Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.label}>{t('student.taskObjective')}</Text>
            <Text style={styles.detailText}>{a.objective}</Text>

            <Text style={styles.label}>{t('student.taskCriterion')}</Text>
            <Text style={styles.detailText}>{a.criterion}</Text>

            {/* Only while the card is actually in the sent-back state. On a
                'Waiting for review' card the same note is the PREVIOUS
                revision request, and it reads as a reply to work the mentor
                has not seen yet. */}
            {a.submission?.status === 'needs_revision' && !!a.submission.mentorNote && (
              <>
                <Text style={styles.label}>{t('mentor.comments')}</Text>
                <Text style={styles.detailText}>{a.submission.mentorNote}</Text>
              </>
            )}

            {actionable && (
              <>
                <Text style={styles.label}>{t('student.whatIDid')}</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  editable={!submitting}
                  placeholderTextColor={colors.textDisabled}
                />

                <Text style={styles.label}>{t('student.whatILearned')}</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={reflection}
                  onChangeText={setReflection}
                  multiline
                  editable={!submitting}
                  placeholderTextColor={colors.textDisabled}
                />

                <View style={styles.evidenceWrap}>
                  <EvidencePicker
                    userId={user?.id || ''}
                    scopeId={a.id}
                    photos={photos}
                    documents={documents}
                    onChange={(nextPhotos, nextDocuments) => {
                      setPhotos(nextPhotos);
                      setDocuments(nextDocuments);
                    }}
                    disabled={submitting}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.primaryBtn, !reflection.trim() && styles.primaryBtnDisabled]}
                  onPress={() => handleSubmit(a)}
                  disabled={submitting || !reflection.trim()}
                  activeOpacity={0.7}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>{t('student.submitTask')}</Text>
                  )}
                </TouchableOpacity>
                {/* An inert button with no explanation is the commonest form
                    of this bug -- the server refuses REFLECTION_REQUIRED too,
                    but this is so the student is not told only after trying. */}
                {!reflection.trim() && (
                  <Text style={styles.hint}>{t('errors.reflectionRequired')}</Text>
                )}
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
  cardHeaderText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  // The task's competency and level, above the title. Same source on all
  // three roles' cards: GroupAssignment.competencyName / .level, resolved
  // once in assignmentService rather than derived per screen.
  competencyLine: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  subtle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
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
  description: {
    marginBottom: spacing.xs,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  docName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
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

  evidenceWrap: {
    marginTop: spacing.sm,
  },

  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
