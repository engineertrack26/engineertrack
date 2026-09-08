import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TextInput,
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
  // assignment id -> the competency its triplet belongs to. Resolved once for
  // the whole list, not per card.
  const [assignmentCompetency, setAssignmentCompetency] =
    useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pickedCompetency, setPickedCompetency] = useState<string | null>(null);
  const [pickedLevel, setPickedLevel] = useState<number | null>(null);
  // Multi-select. The advisor assigns a whole batch at a level, so the picker
  // holds a set of triplet ids rather than one triplet. Title, objective and
  // criterion are no longer editable at creation time -- each assignment takes
  // them from its own triplet, which is what "the triplet text is fixed and
  // adaptation happens by selection" actually means. Per-assignment wording is
  // still reachable afterwards through the edit panel on each card below.
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [triplets, setTriplets] = useState<KpiTriplet[]>([]);
  // Discards a level fetch that a later tap has superseded -- readable
  // inside the async continuation without re-rendering or a stale closure.
  const levelRequest = useRef(0);

  // One due date for the whole batch.
  const [dueDate, setDueDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // The edit sheet lives inline under the card being edited rather than as a
  // separate modal, matching how the create form below is already laid out.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editObjective, setEditObjective] = useState('');
  const [editCriterion, setEditCriterion] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editShowDatePicker, setEditShowDatePicker] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  // Which assignment a withdrawal is in flight for. handleUpdate and
  // handleAssign already had their own flags; without one here a double tap
  // sends two deletes, and the second reports "already has submissions" for a
  // row the first tap withdrew successfully.
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

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

      // Which competency each existing assignment came from, so one whose
      // competency the advisor has since switched off can be marked. The
      // kpi -> competency half is already in framework.kpis; only the
      // triplet -> kpi half needs fetching, and it is fetched for the whole
      // list at once rather than per card. .in() with an empty array returns
      // nothing anyway, so the guard is not just an optimisation.
      if (existing.length > 0) {
        const tripletIds = Array.from(
          new Set(existing.map((a) => a.tripletId).filter(Boolean)),
        );
        const { data, error } = await supabase
          .from('kpi_triplets')
          .select('id, kpi_id')
          .in('id', tripletIds);
        if (error) throw error;
        const kpiOfTriplet: Record<string, string> = {};
        for (const row of data || []) {
          const r = row as Record<string, unknown>;
          kpiOfTriplet[r.id as string] = (r.kpi_id as string) || '';
        }
        const compOfAssignment: Record<string, string> = {};
        for (const a of existing) {
          const comp = framework.kpis.find(
            (k) => k.id === kpiOfTriplet[a.tripletId],
          )?.competencyId;
          if (comp) compOfAssignment[a.id] = comp;
        }
        setAssignmentCompetency(compOfAssignment);
      } else {
        setAssignmentCompetency({});
      }
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

  function chooseCompetency(id: string) {
    setPickedCompetency(id);
    setPickedLevel(null);
    setPickedIds(new Set());
    setTriplets([]);
  }

  async function chooseLevel(level: number) {
    const request = ++levelRequest.current;
    setPickedLevel(level);
    setPickedIds(new Set());
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

  function toggleTriplet(id: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetForm() {
    setPickedCompetency(null);
    setPickedLevel(null);
    setPickedIds(new Set());
    setTriplets([]);
    setDueDate('');
  }

  async function handleAssign() {
    if (!groupId || !user || pickedIds.size === 0) return;

    const chosen = triplets.filter((tr) => pickedIds.has(tr.id));
    if (chosen.length === 0) return;

    setSaving(true);
    try {
      // allSettled, not all: one refused row must not discard the rows that
      // were written. A partial result is reported as a partial result below
      // rather than as a blanket success or a blanket failure.
      const results = await Promise.allSettled(
        chosen.map((tr) =>
          assignmentService.createAssignment({
            groupId,
            tripletId: tr.id,
            title: tr.task,
            objective: tr.objective,
            criterion: tr.criterion,
            dueDate: dueDate || undefined,
            createdBy: user.id,
          }),
        ),
      );

      const created = results.filter((r) => r.status === 'fulfilled').length;
      const firstRejection = results.find((r) => r.status === 'rejected');

      if (created > 0) {
        // ONE notification per student for the whole batch. Notifying per
        // assignment meant N tasks x M students: a student picking up twenty
        // tasks got twenty separate alerts, which is noise, not news.
        //
        // Delivery stays best-effort -- a failure here must never make
        // assignments that were written look like they failed.
        const single = created === 1 ? chosen[0] : null;
        await Promise.all(
          members.map((m) =>
            notificationService.create(
              m.id,
              t('notifications.taskAssignedTitle'),
              single
                ? t('notifications.taskAssignedBody', { title: single.task })
                : t('notifications.tasksAssignedBody', { count: created }),
              'task_assigned',
              {},
            ).catch((e) => console.warn('notify failed:', e)),
          ),
        );
      }

      if (created === chosen.length) {
        Alert.alert(t('common.done'), t('advisor.assignmentsCreated', { count: created }));
        resetForm();
      } else if (created > 0) {
        // Drop the ones that landed from the selection, so the summary counts
        // what is still outstanding rather than what was originally ticked --
        // and so a retry cannot re-send a row that already exists.
        const failedIds = new Set(
          chosen.filter((_, i) => results[i].status === 'rejected').map((tr) => tr.id),
        );
        setPickedIds(failedIds);

        // Say which of the two numbers is which. "Some failed" leaves the
        // advisor unable to tell whether to retry the whole batch.
        Alert.alert(
          t('common.error'),
          t('advisor.assignmentsPartial', { created, total: chosen.length }),
        );
      } else if (firstRejection && firstRejection.status === 'rejected') {
        const reason = firstRejection.reason;
        const { key } = mapRpcError(reason instanceof Error ? reason.message : '');
        Alert.alert(t('common.error'), t(key));
      }

      await loadData();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(a: GroupAssignment) {
    setEditingId(a.id);
    setEditTitle(a.title);
    setEditDescription(a.description || '');
    setEditObjective(a.objective);
    setEditCriterion(a.criterion);
    setEditDueDate(a.dueDate || '');
    setEditShowDatePicker(false);
  }

  function closeEdit() {
    setEditingId(null);
    setEditShowDatePicker(false);
  }

  async function handleUpdate(a: GroupAssignment, canEditTerms: boolean) {
    if (!editTitle.trim()) {
      Alert.alert(t('common.error'), t('advisor.assignmentTitleRequired'));
      return;
    }
    // Send only what changed -- the server is still the authority on whether
    // objective/criterion may move, but there is no reason to resend fields
    // the advisor never touched.
    const patch: {
      title?: string; description?: string | null; dueDate?: string | null;
      objective?: string; criterion?: string;
    } = {};
    const nextTitle = editTitle.trim();
    if (nextTitle !== a.title) patch.title = nextTitle;
    const nextDescription = editDescription.trim();
    if (nextDescription !== (a.description || '')) patch.description = nextDescription || null;
    if (editDueDate !== (a.dueDate || '')) patch.dueDate = editDueDate || null;
    if (canEditTerms) {
      const nextObjective = editObjective.trim();
      const nextCriterion = editCriterion.trim();
      if (nextObjective !== a.objective) patch.objective = nextObjective;
      if (nextCriterion !== a.criterion) patch.criterion = nextCriterion;
    }

    if (Object.keys(patch).length === 0) {
      closeEdit();
      return;
    }

    setEditSaving(true);
    try {
      await assignmentService.updateAssignment(a.id, patch);
      Alert.alert(t('common.done'), t('advisor.assignmentUpdated'));
      closeEdit();
      await loadData();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setEditSaving(false);
    }
  }

  function confirmWithdraw(a: GroupAssignment) {
    Alert.alert(
      t('advisor.withdrawAssignment'),
      t('advisor.withdrawConfirm', { title: a.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('advisor.withdrawAssignment'), style: 'destructive', onPress: () => handleWithdraw(a) },
      ],
    );
  }

  async function handleWithdraw(a: GroupAssignment) {
    // The delete itself is harmless twice -- the second affects zero rows --
    // but a zero-row delete is indistinguishable from a refusal here, so the
    // second tap reports "already has submissions" about an assignment the
    // first tap withdrew successfully.
    if (withdrawingId) return;
    setWithdrawingId(a.id);
    try {
      const removed = await assignmentService.deleteAssignment(a.id);
      if (!removed) {
        Alert.alert(t('common.error'), t('advisor.assignmentHasSubmissions'));
        return;
      }
      Alert.alert(t('common.done'), t('advisor.assignmentWithdrawn'));
      if (editingId === a.id) closeEdit();
      await loadData();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setWithdrawingId(null);
    }
  }

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

        {assignments.map((a) => {
          const counts = submissionCounts[a.id] || ZERO_COUNTS;
          const due = a.dueDate ? fromIsoDate(a.dueDate) : null;
          // Once any submission exists, trg_freeze_assessed_assignment refuses
          // a change to objective/criterion/triplet_id/group_id. `submitted` is
          // the whole tally -- approved and needs_revision are both subsets of
          // it -- and it now comes from group_assignment_counts, which counts
          // exactly the rows assignment_has_submissions sees. So this can no
          // longer disagree with the trigger the way the old client-side count
          // did once a submitting student left the group.
          // countsUnavailable is a lock, not a zero. With no counts the screen
          // cannot tell an untouched assignment from an assessed one, and
          // guessing "untouched" would enable fields the trigger refuses --
          // exactly the contradiction the server-side counts removed. Guess the
          // restrictive way instead, and say so in the hint below.
          const canEditTerms = !countsUnavailable && counts.submitted === 0;
          // trg_assignment_within_scope is BEFORE INSERT only, deliberately, so
          // an advisor may switch a competency off after assigning from it.
          // Nothing else surfaces that: the assignment stays in the student's
          // list, submit_assignment has no scope check, and the NOT_IN_SCOPE
          // refusal finally lands on the MENTOR at review time, who cannot fix
          // it. The advisor can, and this screen is where. An assignment whose
          // competency could not be resolved is not flagged -- no answer is not
          // the same as a negative one.
          const assignedComp = assignmentCompetency[a.id];
          const outOfScope = !!assignedComp && !inScope.has(assignedComp);
          const isEditing = editingId === a.id;
          return (
            <View key={a.id} style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardTitle, styles.cardTitleFlex]}>{a.title}</Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    onPress={() => (isEditing ? closeEdit() : openEdit(a))}
                    activeOpacity={0.7}
                    style={styles.iconBtn}
                  >
                    <Ionicons name={isEditing ? 'close' : 'pencil-outline'} size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => confirmWithdraw(a)}
                    disabled={withdrawingId !== null}
                    activeOpacity={0.7}
                    style={styles.iconBtn}
                  >
                    {withdrawingId === a.id ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
              {!!a.description && <Text style={styles.subtle}>{a.description}</Text>}
              {!!due && (
                <Text style={styles.subtle}>
                  {t('advisor.assignmentDueDate')}: {due.toLocaleDateString(i18n.language)}
                </Text>
              )}
              {outOfScope && (
                <Text style={styles.warning}>{t('advisor.assignmentOutOfScope')}</Text>
              )}
              {/* approved and "sent back" are subsets of submitted, not further
                  buckets alongside it -- the parenthesis is what says so. The
                  member count is a separate question and survives a counts
                  failure, so it is printed either way; printing 0/0/0 in place
                  of counts nobody could load would just be a lie. */}
              <Text style={styles.subtle}>
                {countsUnavailable ? (
                  t('advisor.assignmentCountsUnavailable')
                ) : (
                  <>
                    {t('advisor.submittedCount', { count: counts.submitted })}
                    {' ('}
                    {t('advisor.approvedCount', { count: counts.approved })}
                    {', '}
                    {t('advisor.revisionCount', { count: counts.needsRevision })}
                    {')'}
                  </>
                )}
                {' / '}
                {t('advisor.memberCount', { count: members.length })}
              </Text>

              {isEditing && (
                <View style={styles.editPanel}>
                  <Text style={styles.editPanelTitle}>{t('advisor.editAssignment')}</Text>

                  <Text style={styles.label}>{t('advisor.assignmentTitle')}</Text>
                  <TextInput
                    style={styles.input}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholderTextColor={colors.textDisabled}
                  />

                  <Text style={styles.label}>{t('advisor.assignmentDescription')}</Text>
                  <TextInput
                    style={[styles.input, styles.multilineInput]}
                    value={editDescription}
                    onChangeText={setEditDescription}
                    placeholderTextColor={colors.textDisabled}
                    multiline
                  />

                  <Text style={styles.label}>{t('advisor.assignmentObjective')}</Text>
                  <TextInput
                    style={[
                      styles.input,
                      styles.multilineInput,
                      !canEditTerms && styles.inputDisabled,
                    ]}
                    value={editObjective}
                    onChangeText={setEditObjective}
                    editable={canEditTerms}
                    multiline
                  />

                  <Text style={styles.label}>{t('advisor.assignmentCriterion')}</Text>
                  <TextInput
                    style={[
                      styles.input,
                      styles.multilineInput,
                      !canEditTerms && styles.inputDisabled,
                    ]}
                    value={editCriterion}
                    onChangeText={setEditCriterion}
                    editable={canEditTerms}
                    multiline
                  />

                  {/* Two different reasons for one locked state, and they must
                      not be confused: "students have already submitted" is a
                      fact, and asserting it when the counts never loaded would
                      be inventing one. */}
                  {!canEditTerms && (
                    <Text style={styles.lockedHint}>
                      {countsUnavailable
                        ? t('advisor.assignmentTermsLockedUnknown')
                        : t('advisor.assignmentTermsLocked')}
                    </Text>
                  )}

                  <Text style={styles.label}>{t('advisor.assignmentDueDate')}</Text>
                  <TouchableOpacity
                    style={styles.dateField}
                    onPress={() => setEditShowDatePicker(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={editDueDate ? styles.dateValue : styles.datePlaceholder}>
                      {editDueDate
                        ? fromIsoDate(editDueDate)?.toLocaleDateString(i18n.language)
                        : t('student.selectDate', 'Select a date')}
                    </Text>
                    <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>

                  {editShowDatePicker && (
                    <View style={Platform.OS === 'ios' ? styles.iosPickerBox : undefined}>
                      <DateTimePicker
                        value={fromIsoDate(editDueDate) || new Date()}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(event, selected) => {
                          if (Platform.OS === 'android') setEditShowDatePicker(false);
                          if (event.type === 'dismissed' || !selected) return;
                          setEditDueDate(toIsoDate(selected));
                        }}
                      />
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity
                          style={styles.iosPickerDone}
                          onPress={() => setEditShowDatePicker(false)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.iosPickerDoneText}>{t('common.done')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  <View style={styles.editActionsRow}>
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={closeEdit}
                      disabled={editSaving}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.primaryBtn, styles.editSaveBtn]}
                      onPress={() => handleUpdate(a, canEditTerms)}
                      disabled={editSaving}
                      activeOpacity={0.7}
                    >
                      {editSaving ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}

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
                  const active = pickedIds.has(tr.id);
                  return (
                    <TouchableOpacity
                      key={tr.id}
                      style={[
                        styles.tripletRow,
                        active && styles.tripletRowActive,
                        alreadyAssigned && styles.tripletRowAssigned,
                      ]}
                      onPress={() => toggleTriplet(tr.id)}
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

        {pickedIds.size > 0 && (
          <View style={styles.card}>
            <Text style={styles.selectedCount}>
              {t('advisor.tripletsSelected', { count: pickedIds.size })}
            </Text>
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
              onPress={handleAssign}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('advisor.assign')}</Text>
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

  // Card
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardTitleFlex: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconBtn: {
    padding: spacing.xs,
  },
  subtle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
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
    marginBottom: spacing.sm,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: colors.surface,
    color: colors.textDisabled,
  },
  warning: {
    fontSize: 13,
    color: colors.warning,
    marginTop: spacing.xs,
  },
  editPanel: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  editPanelTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  lockedHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  editSaveBtn: {
    flex: 1,
    marginTop: 0,
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
