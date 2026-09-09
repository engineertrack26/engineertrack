import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { assignmentService } from '@/services/assignments';
import { competencyService } from '@/services/competency';
import { groupService } from '@/services/group';
import { notificationService } from '@/services/notifications';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { selectableTriplets } from '@/utils/tripletSelection';
import { colors, spacing, borderRadius } from '@/theme';
import { AssignmentCard } from '@/components/cards';
import type { Competency, CompetencyKpi } from '@/types/competency';
import type { GroupAssignment, KpiTriplet } from '@/types/assignment';
import type { GroupMember } from '@/types/group';

const ADVISOR_COLOR = colors.info;
const LEVELS = [1, 2, 3, 4];

// The database column is DATE and the rest of the app passes these around as
// 'YYYY-MM-DD' strings, so that stays the stored shape. Only the display
// changes.
//
// Both helpers work in LOCAL time on purpose. toISOString() converts local
// midnight to UTC, which in any positive offset lands on the previous day, and
// new Date('2026-09-01') is parsed as UTC and then rendered locally, which does
// the same thing in reverse. Either one silently shifts the due date by a day.
function toIsoDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function fromIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

type SubmissionCounts = Record<
  string,
  { submitted: number; approved: number; needsRevision: number }
>;

const ZERO_COUNTS = { submitted: 0, approved: 0, needsRevision: 0 };

export default function GroupAssignmentsScreen() {
  const { t, i18n } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const user = useAuthStore((s) => s.user);

  const [assignments, setAssignments] = useState<GroupAssignment[]>([]);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [kpis, setKpis] = useState<CompetencyKpi[]>([]);
  // The whole roster, not just its length: a later task notifies every member
  // when an assignment is created and needs each one's profile id, and
  // re-deriving that list on the hot path risks it disagreeing with this one.
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [submissionCounts, setSubmissionCounts] = useState<SubmissionCounts>({});
  // The counts failed to load. NOT the same as "there are no submissions":
  // under this flag the screen does not know whether an assignment has been
  // acted on, so it has to assume it might have been. See canEditTerms.
  const [countsUnavailable, setCountsUnavailable] = useState(false);
  // The group's competency scope, kept as its own set rather than derived from
  // `competencies` above: that list is the PICKER, already filtered to what is
  // in scope, so it can no longer answer "was this one dropped?" about an
  // assignment that already exists.
  const [inScope, setInScope] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  // "Send to students" publishes the whole tray in one RPC call, so one flag
  // covers it -- unlike withdraw, there is no per-row identity to track here.
  const [sending, setSending] = useState(false);

  const [pickedCompetency, setPickedCompetency] = useState<string | null>(null);
  const [pickedLevel, setPickedLevel] = useState<number | null>(null);
  // Multi-select: the advisor builds a batch across the whole framework, not
  // within one screenful. Title, objective and criterion are not editable at
  // creation time -- each assignment takes them from its own triplet, which is
  // what "the triplet text is fixed and adaptation happens by selection"
  // actually means. Per-assignment wording stays reachable afterwards through
  // the edit panel on each card below.
  //
  // Holds the TRIPLETS, not just their ids, and that is load-bearing:
  // `triplets` below only ever contains the level currently on screen, so an
  // id-only set could not be resolved back to a task once the advisor moved to
  // another competency. handleAddToDraft would have created just the visible
  // ones and reported success for all of them.
  const [picked, setPicked] = useState<Map<string, KpiTriplet>>(new Map());
  const [triplets, setTriplets] = useState<KpiTriplet[]>([]);
  // Discards a level fetch that a later tap has superseded -- readable
  // inside the async continuation without re-rendering or a stale closure.
  const levelRequest = useRef(0);

  // One due date for the whole batch.
  const [dueDate, setDueDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Per-card edit/withdraw/document state (title, objective, due date, the
  // draft's document attach) lives inside AssignmentCard itself now -- see
  // src/components/cards/AssignmentCard.tsx. This screen only needs to know
  // that something changed, so it can re-run the one query both the draft
  // tray and the sent list read from.

  const loadData = useCallback(async () => {
    if (!groupId) return;
    try {
      // The counts come from group_assignment_counts, not from a select on
      // assignment_submissions. That select is scoped by the table's SELECT
      // policy, which needs an ACTIVE membership, while the delete policy and
      // the freeze trigger both go through assignment_has_submissions, which is
      // unscoped -- so a student who submits and then joins another group used
      // to disappear from this line while still locking the row underneath it.
      const [existing, framework, targets, groupMembers, counts] = await Promise.all([
        assignmentService.listGroupAssignments(groupId),
        competencyService.listFramework(),
        competencyService.getGroupTargets(groupId),
        groupService.listMembers(groupId),
        // Caught here so it cannot empty this screen. Promise.all rejects as a
        // unit and setAssignments runs only after the whole array resolves, so
        // without this a failure of the counts alone leaves `assignments` at []
        // and the advisor reads "No assignments yet. Pick a competency below to
        // create one." for a group that has assignments -- and creates a
        // duplicate. That is the same principle as the mentor dashboard's
        // .catch, applied to the query this change itself added, and it is not
        // hypothetical: group_assignment_counts is new, so until
        // docs/task-assignment-rpcs.sql is re-applied PostgREST answers
        // PGRST202 on every load.
        //
        // null rather than []. An empty array is indistinguishable from "no
        // submissions anywhere", and reading it that way would make
        // canEditTerms true for every assignment and silently restore the very
        // disagreement these counts exist to remove: term fields enabled that
        // the freeze trigger then refuses. A degraded state has to be MORE
        // restrictive than the real one, not less.
        assignmentService.getAssignmentCounts(groupId).catch(() => null),
      ]);
      setAssignments(existing);
      const scoped = new Set(targets.map((tg) => tg.competencyId));
      setInScope(scoped);
      setCompetencies(framework.competencies.filter((c) => scoped.has(c.id)));
      setKpis(framework.kpis);
      setMembers(groupMembers);

      setCountsUnavailable(counts === null);
      const byAssignment: SubmissionCounts = {};
      for (const c of counts || []) {
        byAssignment[c.assignmentId] = {
          submitted: c.submitted,
          approved: c.approved,
          needsRevision: c.needsRevision,
        };
      }
      setSubmissionCounts(byAssignment);


    } catch (err) {
      console.error('Load assignments error:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Browsing a different competency or level does NOT clear the selection. A
  // batch is built across the framework, not within one screenful, and losing
  // ticked tasks on a stray tap is the opposite of what multi-select is for.
  // The running count in the summary below is what keeps it honest.
  function chooseCompetency(id: string) {
    setPickedCompetency(id);
    setPickedLevel(null);
    setTriplets([]);
  }

  async function chooseLevel(level: number) {
    const request = ++levelRequest.current;
    setPickedLevel(level);
    setTriplets([]);
    const levelKpis = kpis.filter(
      (k) => k.competencyId === pickedCompetency && k.level === level,
    );
    const lists = await Promise.all(levelKpis.map((k) => assignmentService.listTriplets(k.id)));
    // A later tap already superseded this fetch. setPickedLevel is synchronous
    // and the fetch is not, so without this the last response to ARRIVE wins
    // rather than the last one requested, and the list can show one level's
    // triplets under another level's highlighted chip.
    if (request !== levelRequest.current) return;
    setTriplets(lists.flat());
  }

  function toggleTriplet(tr: KpiTriplet) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(tr.id)) next.delete(tr.id);
      else next.set(tr.id, tr);
      return next;
    });
  }

  function resetForm() {
    setPickedCompetency(null);
    setPickedLevel(null);
    setPicked(new Map());
    setTriplets([]);
    setDueDate('');
  }

  // Writes the batch as drafts, not sent assignments -- createAssignment
  // (singular, called once per triplet here) now leaves published_at unset,
  // so the rows land in the tray rather than reaching students. Rows are
  // written here, on this one tap, rather than on every tick: a
  // tick-and-untick would otherwise be a write and a delete, and the
  // multi-select would stop behaving like a selection.
  async function handleAddToDraft() {
    if (!groupId || !user || picked.size === 0) return;

    // From the selection itself, not from `triplets` -- that array holds only
    // the level on screen, so filtering it would silently drop everything the
    // advisor ticked under another competency and still report success.
    const chosen = Array.from(picked.values());
    if (chosen.length === 0) return;

    setSaving(true);
    try {
      // allSettled, not all: one refused row must not discard the rows that
      // were written. A partial result is reported as a partial result below
      // rather than as a blanket success or a blanket failure.
      const results = await assignmentService.createDrafts(
        chosen.map((tr) => ({
          groupId,
          tripletId: tr.id,
          title: tr.task,
          objective: tr.objective,
          criterion: tr.criterion,
          dueDate: dueDate || undefined,
          createdBy: user.id,
        })),
      );

      const created = results.filter((r) => r.status === 'fulfilled').length;
      const firstRejection = results.find((r) => r.status === 'rejected');

      if (created === chosen.length) {
        Alert.alert(t('common.done'), t('advisor.draftsCreated', { count: created }));
        resetForm();
      } else if (created > 0) {
        // Drop the ones that landed from the selection, so the summary counts
        // what is still outstanding rather than what was originally ticked --
        // and so a retry cannot re-send a row that already exists.
        setPicked(
          new Map(
            chosen
              .filter((_, i) => results[i].status === 'rejected')
              .map((tr) => [tr.id, tr]),
          ),
        );

        // Say which of the two numbers is which. "Some failed" leaves the
        // advisor unable to tell whether to retry the whole batch.
        Alert.alert(
          t('common.error'),
          t('advisor.draftsPartial', { created, total: chosen.length }),
        );
      } else if (firstRejection && firstRejection.status === 'rejected') {
        const reason = firstRejection.reason;
        const { key } = mapRpcError(reason instanceof Error ? reason.message : '');
        Alert.alert(t('common.error'), t(key));
      }

      // The new cards appear in the tray -- no notification here. Nothing
      // has reached a student yet; that is what "Send to students" is for.
      await loadData();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSaving(false);
    }
  }

  // Publishes every draft currently in the tray. publish_assignments
  // re-checks competency scope -- a group's targets can move between
  // drafting and sending -- and refuses the WHOLE batch, naming the
  // offending task, rather than sending some and stopping partway. So unlike
  // handleAddToDraft there is no partial-result branch here: either every
  // draft is published, or none are and the tray is untouched, which is
  // exactly what leaves the advisor able to fix the named task and retry.
  async function handleSendToStudents() {
    if (drafts.length === 0) return;
    setSending(true);
    try {
      const count = await assignmentService.publishAssignments(drafts.map((d) => d.id));

      // count is 0 when every id in the tray was already published --
      // another session (or another tab) sent the same batch first. Nothing
      // moved, so nothing should notify: without this guard, every group
      // member gets a "new task assigned" push for a publish that changed
      // nothing, and the advisor reads "0 tasks sent to students" under a
      // Done header. Reload instead, so the stale tray catches up to what is
      // actually published.
      if (count > 0) {
        // Same batch-notification shape handleAddToDraft's ancestor
        // (handleAssign) used: one notification per student for the whole
        // batch, best-effort so a delivery failure cannot make assignments
        // that were actually sent look like they failed.
        const single = drafts.length === 1 ? drafts[0] : null;
        await Promise.all(
          members.map((m) =>
            notificationService.create(
              m.id,
              t('notifications.taskAssignedTitle'),
              single
                ? t('notifications.taskAssignedBody', { title: single.title })
                : t('notifications.tasksAssignedBody', { count: drafts.length }),
              'task_assigned',
              {},
            ).catch((e) => console.warn('notify failed:', e)),
          ),
        );

        Alert.alert(t('common.done'), t('advisor.assignmentsSent', { count }));
      } else {
        Alert.alert(t('common.done'), t('advisor.assignmentsNoneSent'));
      }
      await loadData();
    } catch (err) {
      const { code, key, detail } = mapRpcError(err instanceof Error ? err.message : '');
      // NOT_IN_SCOPE carries the offending task's title as `detail` -- an
      // advisor told only "something is out of scope" has to hunt through
      // the whole tray for it. The tray is deliberately left untouched (no
      // loadData() here): the advisor has to fix the named task, and
      // reloading could only ever confirm nothing changed.
      if (code === 'NOT_IN_SCOPE' && detail) {
        Alert.alert(t('common.error'), t('errors.notInScopeTitled', { title: detail }));
      } else {
        Alert.alert(t('common.error'), t(key));
      }
    } finally {
      setSending(false);
    }
  }

  // Unset published_at means draft. Derived here, not queried separately --
  // a second fetch is a second thing that can disagree with the first.
  const drafts = assignments.filter((a) => !a.publishedAt);
  const sentAssignments = assignments.filter((a) => !!a.publishedAt);

  // A level has two KPIs and each holds ten triplets, so the picker shows
  // twenty. Grouping under the KPI's statement reads "for this behaviour,
  // these ten tasks" rather than a flat list of twenty.
  const tripletGroups = Array.from(new Set(triplets.map((tr) => tr.kpiId))).map((kpiId) => ({
    kpiId,
    statement: kpis.find((k) => k.id === kpiId)?.statement || '',
    // selectableTriplets marks the ones this group already carries. They stay
    // in the list rather than being filtered out: nothing in the schema stops
    // the same triplet being assigned twice, and a shorter catalogue would
    // read as missing content rather than as work already out there.
    items: selectableTriplets(
      triplets.filter((tr) => tr.kpiId === kpiId),
      assignments,
    ),
  }));

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}><ActivityIndicator size="large" color={ADVISOR_COLOR} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADVISOR_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>{t('advisor.assignments')}</Text>

        {assignments.length === 0 && (
          <Text style={styles.hint}>{t('advisor.noAssignments')}</Text>
        )}

        {/* One list, two views of it -- drafts and sent are both read from
            `assignments`, never from a second query, so the two can no
            longer disagree about a row's state. */}
        {drafts.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>{t('advisor.draftsHeading')}</Text>
            {drafts.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                isDraft
                counts={submissionCounts[a.id] || ZERO_COUNTS}
                countsUnavailable={countsUnavailable}
                memberCount={members.length}
                outOfScope={!!a.competencyId && !inScope.has(a.competencyId)}
                onChanged={loadData}
              />
            ))}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleSendToStudents}
              disabled={sending}
              activeOpacity={0.7}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('advisor.sendToStudents')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {sentAssignments.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>{t('advisor.sentHeading')}</Text>
            {sentAssignments.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                isDraft={false}
                counts={submissionCounts[a.id] || ZERO_COUNTS}
                countsUnavailable={countsUnavailable}
                memberCount={members.length}
                // trg_assignment_within_scope is BEFORE INSERT only,
                // deliberately, so an advisor may switch a competency off
                // after assigning from it. Nothing else surfaces that: the
                // assignment stays in the student's list, submit_assignment
                // has no scope check, and the NOT_IN_SCOPE refusal finally
                // lands on the MENTOR at review time, who cannot fix it. The
                // advisor can, and this screen is where.
                outOfScope={!!a.competencyId && !inScope.has(a.competencyId)}
                onChanged={loadData}
              />
            ))}
          </>
        )}

        <Text style={styles.label}>{t('advisor.pickCompetency')}</Text>
        {competencies.length === 0 && (
          <Text style={styles.hint}>{t('advisor.noCompetencies')}</Text>
        )}
        <View style={styles.chipRow}>
          {competencies.map((c) => {
            const active = pickedCompetency === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => chooseCompetency(c.id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {pickedCompetency && (
          <>
            <Text style={styles.label}>{t('advisor.pickLevel')}</Text>
            <View style={styles.levelRow}>
              {LEVELS.map((level) => {
                const active = pickedLevel === level;
                return (
                  <TouchableOpacity
                    key={level}
                    style={[styles.levelChip, active && styles.levelChipActive]}
                    onPress={() => chooseLevel(level)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.levelText, active && styles.levelTextActive]}>
                      L{level}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {pickedLevel !== null && tripletGroups.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('advisor.pickTriplet')}</Text>
            {tripletGroups.map((group) => (
              <View key={group.kpiId} style={styles.kpiGroup}>
                <Text style={styles.kpiStatement}>{group.statement}</Text>
                {group.items.map(({ triplet: tr, alreadyAssigned }) => {
                  const active = picked.has(tr.id);
                  return (
                    <TouchableOpacity
                      key={tr.id}
                      style={[
                        styles.tripletRow,
                        active && styles.tripletRowActive,
                        alreadyAssigned && styles.tripletRowAssigned,
                      ]}
                      onPress={() => toggleTriplet(tr)}
                      disabled={alreadyAssigned}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={
                          alreadyAssigned
                            ? 'checkmark-done'
                            : active
                              ? 'checkbox'
                              : 'square-outline'
                        }
                        size={18}
                        color={
                          alreadyAssigned
                            ? colors.textDisabled
                            : active
                              ? '#fff'
                              : colors.textSecondary
                        }
                        style={styles.tripletCheck}
                      />
                      <Text
                        style={[
                          styles.tripletText,
                          active && styles.tripletTextActive,
                          alreadyAssigned && styles.tripletTextAssigned,
                        ]}
                      >
                        {tr.task}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {picked.size > 0 && (
          <View style={styles.card}>
            {/* The selection survives moving between competencies, so it can
                include tasks that are not on screen. The count is the only
                thing that shows them -- hence the clear, which is the way back
                out without assigning. */}
            <View style={styles.selectedHeader}>
              <Text style={styles.selectedCount}>
                {t('advisor.tripletsSelected', { count: picked.size })}
              </Text>
              <TouchableOpacity
                onPress={() => setPicked(new Map())}
                disabled={saving}
                activeOpacity={0.7}
              >
                <Text style={styles.clearLink}>{t('advisor.clearSelection')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.selectedHint}>{t('advisor.batchAssignHint')}</Text>

            <Text style={styles.label}>{t('advisor.assignmentDueDate')}</Text>
            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={dueDate ? styles.dateValue : styles.datePlaceholder}>
                {dueDate
                  ? fromIsoDate(dueDate)?.toLocaleDateString(i18n.language)
                  : t('student.selectDate', 'Select a date')}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {showDatePicker && (
              <View style={Platform.OS === 'ios' ? styles.iosPickerBox : undefined}>
                <DateTimePicker
                  value={fromIsoDate(dueDate) || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selected) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (event.type === 'dismissed' || !selected) return;
                    setDueDate(toIsoDate(selected));
                  }}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.iosPickerDone}
                    onPress={() => setShowDatePicker(false)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.iosPickerDoneText}>{t('common.done')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleAddToDraft}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('advisor.addToDraft')}</Text>
              )}
            </TouchableOpacity>
          </View>
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
    marginBottom: spacing.md,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  // Card -- the assignment card itself (header, competency line, edit panel,
  // document attach) lives in AssignmentCard now; this screen only still
  // reuses `card` for the triplet-picker and batch-summary boxes below, and
  // `label` for their field labels.
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  // Draft tray / sent list headings.
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },

  // Competency chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: ADVISOR_COLOR,
    borderColor: ADVISOR_COLOR,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
  },

  // Level picker
  levelRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  levelChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
  },
  levelChipActive: {
    backgroundColor: ADVISOR_COLOR,
    borderColor: ADVISOR_COLOR,
  },
  levelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  levelTextActive: {
    color: '#fff',
  },

  // Triplet picker
  kpiGroup: {
    marginBottom: spacing.md,
  },
  kpiStatement: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  tripletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  tripletRowActive: {
    backgroundColor: ADVISOR_COLOR,
    borderColor: ADVISOR_COLOR,
  },
  tripletRowAssigned: {
    backgroundColor: colors.surface,
    borderStyle: 'dashed',
  },
  tripletCheck: {
    marginRight: spacing.sm,
  },
  tripletText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  tripletTextActive: {
    color: '#fff',
  },
  tripletTextAssigned: {
    color: colors.textDisabled,
  },

  // Batch summary
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearLink: {
    fontSize: 13,
    fontWeight: '600',
    color: ADVISOR_COLOR,
  },
  selectedCount: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  selectedHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  // Due date
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.sm,
  },
  dateValue: {
    fontSize: 15,
    color: colors.text,
  },
  datePlaceholder: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  iosPickerBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  iosPickerDone: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: ADVISOR_COLOR,
    borderRadius: borderRadius.sm,
  },
  iosPickerDoneText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Save button
  primaryBtn: {
    backgroundColor: ADVISOR_COLOR,
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
