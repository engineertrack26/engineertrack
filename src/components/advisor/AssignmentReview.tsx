import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { taskContent, taskContentEdit } from '@/utils/taskContent';
import { GroupContextLabel, GroupModal, groupStyles } from './GroupUI';
import { ui } from '@/components/common/workflowStyles';
import { assignmentService } from '@/services/assignments';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { newAssignmentId, prepareAssignments, type PreparedTask } from '@/utils/assignmentPreparation';
import type { GroupAssignment, KpiTriplet } from '@/types/assignment';
import { toLocalIsoDate } from '@/utils/localDate';
import { TargetPicker, type TargetCandidate } from './TargetPicker';
import { sendBeforeDue } from '@/utils/assignmentSchedule';

/** Where the send-time picker opens: an hour from now, rounded up to the next
 *  half hour. Never under 59 minutes ahead, so it clears both the picker's
 *  minimumDate and the two-minute buffer in acceptSendAt. */
function defaultSendTime(now: Date = new Date()): Date {
  const d = new Date(now.getTime() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() <= 30 ? (d.getMinutes() === 0 ? 0 : 30) : 60);
  return d;
}

export function AssignmentReview({ groupId, createdBy, triplets, dueDate, memberCount, members, competencyId, onClose, onDone, onPublish }: {
  groupId: string; createdBy: string; triplets: KpiTriplet[]; dueDate: string; memberCount: number;
  /** The group's active members as the picker wants them. `GroupMember` has
   *  firstName/lastName, not name, so the caller maps -- the picker should not
   *  have to know how this project spells a person. */
  members: TargetCandidate[];
  /** The one competency this batch is drawn from, or null when it spans more
   *  than one -- the picker then shows no level badges. */
  competencyId: string | null;
  onClose: () => void; onDone: () => void;
  onPublish: (rows: GroupAssignment[], targetIds: string[], sendAt: string | null) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const [tasks, setTasks] = useState<PreparedTask[]>(() => triplets.map((tr) => ({
    id: newAssignmentId(), groupId, createdBy, tripletId: tr.id,
    title: tr.task, objective: tr.objective, criterion: tr.criterion, dueDate: dueDate || undefined,
  })));
  const [editing, setEditing] = useState<string | null>(null);
  const [batchDate, setBatchDate] = useState(dueDate);
  const [showDate, setShowDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failed, setFailed] = useState(false);
  // The audience is chosen once per batch, and defaults to the whole group so
  // an advisor who never opens the picker keeps today's behaviour exactly.
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  // The picker edits its own copy, seeded from targetIds when it opens and
  // discarded on close. Without this, ticking two names and then tapping the
  // X still sent the task to those two -- the picker's own toggle wrote
  // straight into targetIds, so there was no difference between Cancel and
  // Continue.
  const [draftTargetIds, setDraftTargetIds] = useState<string[]>([]);
  // null means "send now", which is what the screen did before this existed.
  const [sendAt, setSendAt] = useState<string | null>(null);
  // Android's picker does date or time, never both, so the choice is two
  // steps: the day first (kept in pendingDay), then the time.
  const [sendStep, setSendStep] = useState<'date' | 'time' | null>(null);
  const [pendingDay, setPendingDay] = useState<Date | null>(null);
  // iOS shows one inline date-and-time wheel that fires onChange on every
  // movement, so its value is only a draft until Done.
  const [iosDraft, setIosDraft] = useState<Date | null>(null);
  // Fixed when the picker opens, so the wheel does not drift while it is shown.
  const [sendSeed, setSendSeed] = useState<Date>(() => defaultSendTime());
  const [sendError, setSendError] = useState<string | null>(null);
  const running = useRef(false);
  const snapshot = useRef<PreparedTask[] | null>(null);

  function change(id: string, patch: Partial<PreparedTask>) {
    setTasks((old) => old.map((task) => task.id === id ? { ...task, ...patch } : task));
  }

  function changeDate(value: string) {
    setBatchDate(value);
    // A send time that is now later than the new due date would be a task
    // that arrives after it is due; drop it rather than keep it silently.
    if (sendAt && !sendBeforeDue(sendAt, value || undefined)) {
      setSendAt(null);
      setSendError(t('taskFlow.sendCleared', 'Due date moved, so the scheduled send was cleared.'));
    }
    setTasks((old) => old.map((task) => ({ ...task, dueDate: value || undefined })));
  }

  /** Accepts a send time only when it is in the future and not after the due
   *  date; otherwise says why, inline, and keeps whatever was chosen before. */
  function acceptSendAt(candidate: Date) {
    const iso = candidate.toISOString();
    // A two-minute buffer: the picker is minute-grained and the advisor
    // takes a moment to tap Send, so the current minute is already late.
    if (candidate.getTime() <= Date.now() + 2 * 60 * 1000) {
      setSendError(t('errors.scheduleInPast'));
    } else if (!sendBeforeDue(iso, batchDate || undefined)) {
      setSendError(t('taskFlow.sendAfterDue', 'The send time cannot be after the due date.'));
    } else {
      setSendError(null);
      setSendAt(iso);
    }
  }

  function close() {
    if (running.current) return;
    Alert.alert(t('taskFlow.review'), t(attempted ? 'taskFlow.leaveSaved' : 'taskFlow.leaveReview'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('advisorGroups.close'), onPress: attempted ? onDone : onClose },
    ]);
  }

  async function pickDocument(id: string) {
    if (running.current || attempted) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true, multiple: false,
      });
      if (!result.canceled && result.assets[0]) {
        const a = result.assets[0];
        change(id, { document: { uri: a.uri, name: a.name,
          mimeType: a.mimeType || (a.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' :
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document') } });
      }
    } catch {
      Alert.alert(t('common.error'), t('student.documentPickerError'));
    } finally { running.current = false; setBusy(false); }
  }

  async function finish(send: boolean) {
    if (running.current || useAuthStore.getState().user?.id !== createdBy) return;
    if (tasks.some((a) => !a.title.trim() || !a.objective.trim() || !a.criterion.trim())) {
      Alert.alert(t('common.error'), t('taskFlow.required'));
      return;
    }
    running.current = true;
    setBusy(true);
    setAttempted(true);
    setEditing(null);
    setShowDate(false);
    setSendStep(null);
    setIosDraft(null);
    setFailed(false);
    // Freeze after the first attempt: retry must recover the exact rows, not
    // silently overwrite a task another session may already have published.
    snapshot.current ??= tasks.map((a) => ({ ...a, title: a.title.trim(),
      objective: a.objective.trim(), criterion: a.criterion.trim(), description: a.description?.trim() }));
    try {
      const rows = await prepareAssignments(snapshot.current, assignmentService);
      if (useAuthStore.getState().user?.id !== createdBy) throw new Error('Session changed');
      if (send) {
        if (!await onPublish(rows, targetIds, sendAt)) { setFailed(true); return; }
      } else {
        if (rows.some((row) => row.publishedAt)) throw new Error('PREPARED_TASK_CHANGED');
        Alert.alert(t('common.done'), t('advisor.draftsCreated', { count: rows.length }));
      }
      onDone();
    } catch (err) {
      setFailed(true);
      const message = err instanceof Error ? err.message : '';
      const { key } = mapRpcError(message);
      Alert.alert(t('common.error'), t(message === 'PREPARED_TASK_CHANGED' ? 'taskFlow.changed' : key));
    } finally { running.current = false; setBusy(false); }
  }

  return <GroupModal title={t('taskFlow.review')} onClose={close} busy={busy} footer={<>
    {memberCount === 0 && <Text style={ui.secondary}>{t('taskFlow.noMembers')}</Text>}
    <TouchableOpacity style={[ui.primary, (busy || memberCount === 0) && { opacity: 0.5 }]}
      accessibilityRole="button" accessibilityState={{ disabled: busy || memberCount === 0 }}
      disabled={busy || memberCount === 0} onPress={() => finish(true)}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.primaryText}>{sendAt ? t('taskFlow.scheduleCount', 'Schedule {{count}} tasks', { count: tasks.length }) : t('taskFlow.send', { count: tasks.length })}</Text>}
    </TouchableOpacity>
    <TouchableOpacity style={groupStyles.outline} accessibilityRole="button" disabled={busy} onPress={() => finish(false)}>
      <Text style={groupStyles.linkText}>{t('taskFlow.saveDraft')}</Text>
    </TouchableOpacity>

  </>}>
    <GroupContextLabel groupId={groupId} />
    <Text style={ui.body}>{t('taskFlow.summary', { tasks: tasks.length, students: targetIds.length || memberCount })}</Text>
    <Text style={ui.label}>{t('taskFlow.audience', 'Who gets this')}</Text>
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {(['group', 'selected'] as const).map((value) => {
        const on = value === 'group' ? targetIds.length === 0 : targetIds.length > 0;
        return (
          <TouchableOpacity key={value} accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[groupStyles.outline, on && groupStyles.selected]}
            // Frozen after a successful attempt, same as everything else --
            // but a failed one leaves the audience open, because the fix for
            // a failed send (a departed student was still named) is a
            // different audience, and a retry that cannot change it can only
            // fail the same way again.
            disabled={busy || (attempted && !failed)}
            onPress={() => {
              if (value === 'group') { setTargetIds([]); return; }
              setDraftTargetIds(targetIds);
              setPicking(true);
            }}>
            <Text style={groupStyles.linkText}>
              {value === 'group'
                ? t('taskFlow.audienceGroup', 'Whole group ({{count}})', { count: memberCount })
                : targetIds.length > 0
                  ? t('taskFlow.audienceSelectedCount', '{{count}} students', { count: targetIds.length })
                  : t('taskFlow.audienceSelected', 'Selected students')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
    <Text style={ui.label}>{t('taskFlow.sendWhen', 'When to send')}</Text>
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {(['now', 'later'] as const).map((value) => {
        const on = value === 'now' ? !sendAt : !!sendAt;
        return (
          <TouchableOpacity key={value} accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[groupStyles.outline, on && groupStyles.selected]}
            disabled={busy || (attempted && !failed)}
            onPress={() => {
              if (value === 'now') { setSendAt(null); setSendError(null); setSendStep(null); setIosDraft(null); return; }
              setShowDate(false);
              const seed = sendAt ? new Date(sendAt) : defaultSendTime();
              setSendSeed(seed);
              setIosDraft(seed);
              setSendStep('date');
            }}>
            <Text style={groupStyles.linkText}>
              {value === 'now'
                ? t('taskFlow.sendNow', 'Send now')
                : sendAt
                  ? t('taskFlow.sendAtValue', 'On {{when}}', {
                      when: new Date(sendAt).toLocaleString(i18n.language),
                    })
                  : t('taskFlow.sendLater', 'Schedule')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
    {!!sendError && <View style={ui.note}><Text accessibilityRole="alert" style={ui.body}>{sendError}</Text></View>}
    {sendStep && (!attempted || failed) && <View>
      <DateTimePicker
        value={Platform.OS === 'ios' ? (iosDraft ?? sendSeed)
          : sendStep === 'time' && pendingDay ? pendingDay : sendSeed}
        mode={Platform.OS === 'ios' ? 'datetime' : sendStep}
        minimumDate={Platform.OS === 'ios' || sendStep === 'date' ? new Date() : undefined}
        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
        onChange={(event, value) => {
          if (Platform.OS === 'ios') {
            if (value) setIosDraft(value);
            return;
          }
          setSendStep(null);
          if (event.type === 'dismissed' || !value) return;
          if (sendStep === 'date') {
            setPendingDay(value);
            // The time picker opens on the next tick, after Android has
            // torn the date dialog down.
            setTimeout(() => setSendStep('time'), 0);
            return;
          }
          const day = pendingDay ?? value;
          acceptSendAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(),
            value.getHours(), value.getMinutes()));
          setPendingDay(null);
        }} />
      {Platform.OS === 'ios' && <TouchableOpacity accessibilityRole="button" onPress={() => {
        acceptSendAt(iosDraft ?? sendSeed);
        setIosDraft(null);
        setSendStep(null);
      }}>
        <Text style={ui.link}>{t('common.done')}</Text>
      </TouchableOpacity>}
    </View>}
    <TouchableOpacity style={groupStyles.outline} accessibilityRole="button" disabled={attempted || busy}
      onPress={() => { setSendStep(null); setIosDraft(null); setShowDate(true); }}>
      <Text style={groupStyles.linkText}>{t('advisor.assignmentDueDate')}: {batchDate
        ? new Date(batchDate + 'T12:00:00').toLocaleDateString(i18n.language) : t('taskFlow.noDate')}</Text>
    </TouchableOpacity>
    {!!batchDate && !attempted && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => changeDate('')}>
      <Text style={ui.link}>{t('taskFlow.clearDate')}</Text>
    </TouchableOpacity>}
    {showDate && !attempted && <View>
      <DateTimePicker value={batchDate ? new Date(batchDate + 'T12:00:00') : new Date()}
        mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
        onChange={(event, value) => {
          if (Platform.OS !== 'ios') setShowDate(false);
          if (event.type === 'dismissed' || !value) return;
          changeDate(toLocalIsoDate(value));
        }} />
      {Platform.OS === 'ios' && <TouchableOpacity accessibilityRole="button" onPress={() => setShowDate(false)}>
        <Text style={ui.link}>{t('common.done')}</Text>
      </TouchableOpacity>}
    </View>}
    <Text style={ui.secondary}>{t('taskFlow.reviewHint')}</Text>
    {failed && <View style={ui.note}><Text accessibilityRole="alert" style={ui.body}>{t('taskFlow.retryHint')}</Text></View>}
    {tasks.map((task, index) => <View key={task.id} style={ui.card}>
      <Text style={ui.cardTitle}>{index + 1}. {taskContent(task.title, i18n.language)}</Text>
      {(['objective', 'criterion'] as const).map((field) => <View key={field}>
        <Text style={ui.label}>{t(field === 'objective' ? 'advisor.assignmentObjective' : 'advisor.assignmentCriterion')}</Text>
        <Text style={ui.body}>{taskContent(task[field], i18n.language, field)}</Text>
      </View>)}
      {!!task.description && <Text style={ui.body}>{task.description}</Text>}
      {!!task.document && <Text style={ui.secondary}>{task.document.name}</Text>}
      {!attempted && <TouchableOpacity accessibilityRole="button" disabled={busy}
        onPress={() => setEditing(editing === task.id ? null : task.id)}>
        <Text style={ui.link}>{t(editing === task.id ? 'common.done' : 'taskFlow.edit')}</Text>
      </TouchableOpacity>}
      {editing === task.id && <View style={{ gap: 12 }}>
        {(['title', 'description', 'objective', 'criterion'] as const).map((field) => {
          const label = t({ title: 'taskFlow.taskTitle', description: 'advisor.assignmentDescription',
            objective: 'advisor.assignmentObjective', criterion: 'advisor.assignmentCriterion' }[field]);
          const contentField = field === 'title' ? 'task' : field;
          const original = triplets.find(tr => tr.id === task.tripletId);
          return <View key={field} style={{ gap: 6 }}><Text style={ui.label}>{label}</Text>
            <TextInput accessibilityLabel={label} multiline style={ui.input} editable={!busy}
              value={contentField === 'description' ? task.description || '' : taskContent(task[field] || '', i18n.language, contentField)}
              onChangeText={(value) => change(task.id, { [field]: contentField === 'description' ? value
                : taskContentEdit(original?.[contentField] || '', value, i18n.language, contentField) })} />
          </View>;
        })}
        <TouchableOpacity style={groupStyles.outline} accessibilityRole="button" disabled={busy}
          onPress={() => pickDocument(task.id)}>
          <Text style={groupStyles.linkText}>{t(task.document ? 'advisor.replaceDocument' : 'advisor.attachDocument')} · PDF / DOCX</Text>
        </TouchableOpacity>
        {!!task.document && <TouchableOpacity accessibilityRole="button" disabled={busy}
          onPress={() => change(task.id, { document: undefined })}>
          <Text style={ui.link}>{t('taskFlow.removeFile')}</Text>
        </TouchableOpacity>}
      </View>}
    </View>)}
    {picking && <TargetPicker visible groupId={groupId} competencyId={competencyId}
      students={members} selected={draftTargetIds}
      onToggle={(id) => setDraftTargetIds((old) =>
        old.includes(id) ? old.filter((x) => x !== id) : [...old, id])}
      // Continue commits the draft; the X (onClose) discards it and leaves
      // targetIds exactly as it was before the sheet opened.
      onSubmit={() => { setTargetIds(draftTargetIds); setPicking(false); }}
      onClose={() => setPicking(false)} />}
  </GroupModal>;
}
