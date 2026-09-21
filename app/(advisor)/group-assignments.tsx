import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, Alert, Platform, TextInput,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { fromLocalIsoDate, toLocalIsoDate } from '@/utils/localDate';
import { taskContent } from '@/utils/taskContent';
import { competencyContent } from '@/utils/competencyContent';
import { kpiContent } from '@/utils/kpiContent';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { assignmentService } from '@/services/assignments';
import { competencyService } from '@/services/competency';
import { groupService } from '@/services/group';
import { notificationService } from '@/services/notifications';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { selectableTriplets } from '@/utils/tripletSelection';
import { reviewedAssignmentsMatch } from '@/utils/assignmentPreparation';
import { colors, spacing, borderRadius, fonts } from '@/theme';
import { AssignmentCard } from '@/components/cards';
import type { Competency, CompetencyKpi } from '@/types/competency';
import type { GroupAssignment, KpiTriplet } from '@/types/assignment';
import type { GroupMember } from '@/types/group';
import { groupCenterRoute } from '@/utils/advisorGroups';
import { AssignmentReview } from '@/components/advisor/AssignmentReview';
import { ui } from '@/components/common/workflowStyles';
import { GroupContextLabel, GroupModal } from '@/components/advisor/GroupUI';
import { BackButton, LoadFailedBanner } from '@/components/common';

const ADVISOR_COLOR = colors.info;
const LEVELS = [1, 2, 3, 4];

// The database column is DATE and the rest of the app passes these around as
// 'YYYY-MM-DD' strings, so that stays the stored shape. Only the display
// changes.
//
type SubmissionCounts = Record<
  string,
  { submitted: number; approved: number; needsRevision: number }
>;

const ZERO_COUNTS = { submitted: 0, approved: 0, needsRevision: 0 };

export default function GroupAssignmentsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  return <GroupAssignmentsContent key={`${userId}:${groupId}`} />;
}

function GroupAssignmentsContent() {
  const { t, i18n } = useTranslation();
  const { groupId, fromGroup } = useLocalSearchParams<{ groupId?: string; fromGroup?: string }>();
  const groupBack = groupId && fromGroup === '1' ? groupCenterRoute(groupId) : { pathname: '/(advisor)/groups' as const, params: { groupId: '' } };
  const user = useAuthStore((s) => s.user);

  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewingDrafts, setReviewingDrafts] = useState(false);
  const [tab, setTab] = useState<'published' | 'drafts'>('published');
  const [search, setSearch] = useState('');
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const publishLock = useRef(false);
  const loadRequest = useRef(0);
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
  // A publish operation contains only the explicitly reviewed batch.
  const [sending, setSending] = useState(false);

  const [pickedCompetency, setPickedCompetency] = useState<string | null>(null);
  const [pickedLevel, setPickedLevel] = useState<number | null>(null);
  // Keep full triplets across competency/level changes. The review screen
  // edits local copies; selection itself never writes to the database.
  const [picked, setPicked] = useState<Map<string, KpiTriplet>>(new Map());
  const [triplets, setTriplets] = useState<KpiTriplet[]>([]);
  // Discards a level fetch that a later tap has superseded -- readable
  // inside the async continuation without re-rendering or a stale closure.
  const levelRequest = useRef(0);
  const [loadingTriplets, setLoadingTriplets] = useState(false);

  // One due date for the whole batch.
  const [dueDate, setDueDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Per-card edit/withdraw/document state (title, objective, due date, the
  // draft's document attach) lives inside AssignmentCard itself now -- see
  // src/components/cards/AssignmentCard.tsx. This screen only needs to know
  // that something changed, so it can re-run the one query both the draft
  // tray and the sent list read from.

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    const request = ++loadRequest.current;
    if (!groupId || !user) { setLoadFailed(true); setLoading(false); return; }
    setLoadFailed(false);
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
      if (request !== loadRequest.current) return;
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
      if (request !== loadRequest.current) return;
      console.warn('Load assignments error:', err);
      setLoadFailed(true);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [groupId, user?.id]);

  useFocusEffect(useCallback(() => { loadData(); return () => { loadRequest.current += 1; }; }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Browsing a different competency or level does NOT clear the selection. A
  // batch is built across the framework, not within one screenful, and losing
  // ticked tasks on a stray tap is the opposite of what multi-select is for.
  // The running count in the summary below is what keeps it honest.
  // Every transition that empties the list also invalidates any level fetch
  // still in flight, not only a newer level tap. Without this, switching from
  // competency A to B while A's level was loading let A's late response land
  // under B's heading -- the same stale-response bug chooseLevel guards
  // against, reached from a different tap.
  function invalidateLevelFetch() {
    levelRequest.current += 1;
    setLoadingTriplets(false);
  }

  function chooseCompetency(id: string) {
    invalidateLevelFetch();
    setPickedCompetency(id);
    setPickedLevel(null);
    setTriplets([]);
  }

  async function chooseLevel(level: number) {
    const request = ++levelRequest.current;
    setPickedLevel(level);
    setTriplets([]);
    setLoadingTriplets(true);
    const levelKpis = kpis.filter(
      (k) => k.competencyId === pickedCompetency && k.level === level,
    );
    let lists: KpiTriplet[][];
    try {
      lists = await Promise.all(levelKpis.map((k) => assignmentService.listTriplets(k.id)));
    } catch (err) {
      if (request !== levelRequest.current) return;
      setLoadingTriplets(false);
      // An empty picker after a failed read looks like "no tasks at this
      // level", which is a different fact. Say what happened.
      console.warn('Triplet load failed:', err instanceof Error ? err.message : err);
      Alert.alert(t('common.error'), t('advisor.tripletsLoadFailed'));
      return;
    }
    // A later tap already superseded this fetch. setPickedLevel is synchronous
    // and the fetch is not, so without this the last response to ARRIVE wins
    // rather than the last one requested, and the list can show one level's
    // triplets under another level's highlighted chip.
    if (request !== levelRequest.current) return;
    setLoadingTriplets(false);
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
    invalidateLevelFetch();
    setPickedCompetency(null);
    setPickedLevel(null);
    setPicked(new Map());
    setTriplets([]);
    setDueDate('');
    setShowDatePicker(false);
  }

  async function handleSendToStudents(batch: GroupAssignment[]): Promise<boolean> {
    if (!batch.length || publishLock.current || !user ||
        useAuthStore.getState().user?.id !== user.id) return false;
    publishLock.current = true;
    setSending(true);
    try {
      const current = await assignmentService.listGroupAssignments(groupId!);
      if (!reviewedAssignmentsMatch(batch, current)) {
        setAssignments(current);
        Alert.alert(t('common.error'), t('taskFlow.changed'));
        return false;
      }
      if (useAuthStore.getState().user?.id !== user.id) return false;
      const count = await assignmentService.publishAssignments(batch.map((d) => d.id));

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
        const single = batch.length === 1 ? batch[0] : null;
        await Promise.all(
          members.map((m) =>
            notificationService.create(
              m.id,
              t('notifications.taskAssignedTitle'),
              single
                ? t('notifications.taskAssignedBody', { title: single.title })
                : t('notifications.tasksAssignedBody', { count }),
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
      setSelectedDraftIds([]);
      setReviewingDrafts(false);
      return true;
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
      return false;
    } finally {
      publishLock.current = false;
      setSending(false);
    }
  }

  // Unset published_at means draft. Derived here, not queried separately --
  // a second fetch is a second thing that can disagree with the first.
  const drafts = assignments.filter((a) => !a.publishedAt);
  const sentAssignments = assignments.filter((a) => !!a.publishedAt);
  const selectedDrafts = drafts.filter((a) => selectedDraftIds.includes(a.id));
  const visibleAssignments = (tab === 'drafts' ? drafts : sentAssignments).filter((a) =>
    [taskContent(a.title, i18n.language), a.title, a.description, competencyContent(a.competencyName, i18n.language), a.competencyName].some((value) =>
      value?.toLocaleLowerCase(i18n.language).includes(search.trim().toLocaleLowerCase(i18n.language))));
  function closeSelection() {
    if (!picked.size) { setAdding(false); return; }
    Alert.alert(t('taskFlow.add'), t('taskFlow.leaveSelection'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('advisorGroups.close'), onPress: () => { resetForm(); setAdding(false); } },
    ]);
  }
  function finishReview() {
    setReviewing(false);
    setAdding(false);
    resetForm();
    loadData();
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
        <BackButton href={groupBack} />
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
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <BackButton href={groupBack} disabled={reviewing || sending} />
        <GroupContextLabel groupId={groupId} />
        <Text style={styles.screenTitle}>{t('advisor.assignments')}</Text>

        <TouchableOpacity style={ui.primary} accessibilityRole="button" disabled={loadFailed}
          onPress={() => setAdding(true)}>
          <Text style={ui.primaryText}>{t('taskFlow.add')}</Text>
        </TouchableOpacity>
        <View style={[styles.chipRow, { marginTop: 16 }]} accessibilityRole="tablist">
          {(['published', 'drafts'] as const).map((value) => <TouchableOpacity key={value}
            accessibilityRole="tab" accessibilityState={{ selected: tab === value }}
            style={[styles.chip, tab === value && styles.chipActive]} onPress={() => setTab(value)}>
            <Text style={[styles.chipText, tab === value && styles.chipTextActive]}>
              {t(value === 'published' ? 'advisor.sentHeading' : 'advisor.draftsHeading')}
              {' '}({value === 'published' ? sentAssignments.length : drafts.length})
            </Text>
          </TouchableOpacity>)}
        </View>
        <TextInput style={[ui.input, { marginBottom: 16 }]} value={search} onChangeText={setSearch}
          placeholder={t('taskFlow.search')} accessibilityLabel={t('taskFlow.search')} />
        {!visibleAssignments.length && !loadFailed && <Text style={styles.hint}>{t('taskFlow.empty')}</Text>}
        {tab === 'drafts' && selectedDrafts.length > 0 && <TouchableOpacity accessibilityRole="button"
          style={[ui.primary, { marginBottom: 16 }]} disabled={sending || loadFailed}
          onPress={() => setReviewingDrafts(true)}>
          <Text style={ui.primaryText}>{t('taskFlow.review')} ({selectedDrafts.length})</Text>
        </TouchableOpacity>}
        {visibleAssignments.map((a) => <View key={a.id}>
          {tab === 'drafts' && <TouchableOpacity accessibilityRole="checkbox"
            accessibilityState={{ checked: selectedDraftIds.includes(a.id) }}
            style={styles.draftSelect} onPress={() => setSelectedDraftIds((ids) =>
              ids.includes(a.id) ? ids.filter((id) => id !== a.id) : [...ids, a.id])}>
            <Ionicons name={selectedDraftIds.includes(a.id) ? 'checkbox' : 'square-outline'}
              size={24} color={ADVISOR_COLOR} />
            <Text style={styles.chipText}>{t('taskFlow.selectSend')}</Text>
          </TouchableOpacity>}
          <AssignmentCard assignment={a} isDraft={!a.publishedAt}
            counts={submissionCounts[a.id] || ZERO_COUNTS} countsUnavailable={countsUnavailable}
            memberCount={members.length} outOfScope={!!a.competencyId && !inScope.has(a.competencyId)}
            onChanged={loadData} />
        </View>)}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
      {adding && !reviewing && <GroupModal title={t('taskFlow.add')} onClose={closeSelection} footer={<>
        <Text style={ui.label}>{t('advisor.tripletsSelected', { count: picked.size })}</Text>
        <TouchableOpacity style={[ui.primary, picked.size === 0 && { opacity: 0.5 }]}
          accessibilityRole="button" disabled={picked.size === 0}
          accessibilityState={{ disabled: picked.size === 0 }}
          onPress={() => { setShowDatePicker(false); setReviewing(true); }}>
          <Text style={ui.primaryText}>{t('taskFlow.review')}</Text>
        </TouchableOpacity>
      </>}>
        <GroupContextLabel groupId={groupId} />
        <Text style={ui.secondary}>{t('taskFlow.selectionHint')}</Text>
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
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{competencyContent(c.name, i18n.language)}</Text>
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

        {pickedLevel !== null && loadingTriplets && (
          <View style={styles.card}>
            <ActivityIndicator size="small" color={ADVISOR_COLOR} />
          </View>
        )}

        {pickedLevel !== null && tripletGroups.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('advisor.pickTriplet')}</Text>
            {tripletGroups.map((group) => (
              <View key={group.kpiId} style={styles.kpiGroup}>
                <Text style={styles.kpiStatement}>{kpiContent(group.statement, i18n.language)}</Text>
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
                              ? colors.textOnPrimary
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
                        {taskContent(tr.task, i18n.language)}
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
                activeOpacity={0.7}
              >
                <Text style={styles.clearLink}>{t('advisor.clearSelection')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.selectedHint}>{t('taskFlow.selectionHint')}</Text>

            <Text style={styles.label}>{t('advisor.assignmentDueDate')}</Text>
            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={dueDate ? styles.dateValue : styles.datePlaceholder}>
                {dueDate
                  ? fromLocalIsoDate(dueDate)?.toLocaleDateString(i18n.language)
                  : t('student.selectDate', 'Select a date')}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {!!dueDate && <TouchableOpacity accessibilityRole="button" onPress={() => setDueDate('')}>
              <Text style={ui.link}>{t('taskFlow.clearDate')}</Text>
            </TouchableOpacity>}
            {showDatePicker && (
              <View style={Platform.OS === 'ios' ? styles.iosPickerBox : undefined}>
                <DateTimePicker
                  value={fromLocalIsoDate(dueDate) || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selected) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (event.type === 'dismissed' || !selected) return;
                    setDueDate(toLocalIsoDate(selected));
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


          </View>
        )}


      </GroupModal>}
      {reviewing && groupId && user && <AssignmentReview groupId={groupId} createdBy={user.id}
        triplets={Array.from(picked.values())} dueDate={dueDate} memberCount={members.length}
        onClose={() => setReviewing(false)} onDone={finishReview} onPublish={handleSendToStudents} />}
      {reviewingDrafts && <GroupModal title={t('taskFlow.review')} onClose={() => setReviewingDrafts(false)} busy={sending}>
        <GroupContextLabel groupId={groupId} />
        <Text style={ui.body}>{t('taskFlow.summary', { tasks: selectedDrafts.length, students: members.length })}</Text>
        {selectedDrafts.map((a) => <View key={a.id} style={ui.card}>
          <Text style={ui.cardTitle}>{taskContent(a.title, i18n.language)}</Text>
          <Text style={ui.label}>{t('advisor.assignmentObjective')}</Text><Text style={ui.body}>{taskContent(a.objective, i18n.language, 'objective')}</Text>
          <Text style={ui.label}>{t('advisor.assignmentCriterion')}</Text><Text style={ui.body}>{taskContent(a.criterion, i18n.language, 'criterion')}</Text>
          {!!a.description && <Text style={ui.body}>{a.description}</Text>}
          {!!a.documentName && <Text style={ui.secondary}>{a.documentName}</Text>}
          <Text style={ui.secondary}>{t('advisor.assignmentDueDate')}: {a.dueDate
            ? fromLocalIsoDate(a.dueDate)?.toLocaleDateString(i18n.language) : t('taskFlow.noDate')}</Text>
        </View>)}
        {members.length === 0 && <Text style={ui.secondary}>{t('taskFlow.noMembers')}</Text>}
        <TouchableOpacity style={ui.primary} accessibilityRole="button"
          disabled={sending || !selectedDrafts.length || !members.length}
          onPress={() => handleSendToStudents(selectedDrafts)}>
          {sending ? <ActivityIndicator color="#fff" /> :
            <Text style={ui.primaryText}>{t('taskFlow.send', { count: selectedDrafts.length })}</Text>}
        </TouchableOpacity>
      </GroupModal>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  draftSelect: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
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
    width: '100%', maxWidth: 720, alignSelf: 'center',
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  hint: {
    fontSize: 13, fontFamily: fonts.regular,
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
    borderWidth: 1,
    borderColor: colors.divider,
  },
  label: {
    fontSize: 12, fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  // Draft tray / sent list headings.
  sectionHeading: {
    fontSize: 15,
    fontWeight: '600', fontFamily: fonts.semibold,
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
    minHeight: 48, justifyContent: 'center',
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
    fontWeight: '600', fontFamily: fonts.semibold,
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
    minHeight: 48, justifyContent: 'center',
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
    fontWeight: '600', fontFamily: fonts.semibold,
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
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  tripletRow: {
    minHeight: 48,
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
    fontSize: 13, fontFamily: fonts.regular,
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
    fontWeight: '600', fontFamily: fonts.semibold,
    color: ADVISOR_COLOR,
  },
  selectedCount: {
    fontSize: 15,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: 2,
  },
  selectedHint: {
    fontSize: 12, fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  // Due date
  dateField: {
    minHeight: 48,
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
    fontSize: 15, fontFamily: fonts.regular,
    color: colors.text,
  },
  datePlaceholder: {
    fontSize: 15, fontFamily: fonts.regular,
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
    fontWeight: '600', fontFamily: fonts.semibold,
    color: '#fff',
  },

  // Save button
  primaryBtn: {
    minHeight: 52,
    backgroundColor: ADVISOR_COLOR,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '600', fontFamily: fonts.semibold,
    color: '#fff',
  },
});
