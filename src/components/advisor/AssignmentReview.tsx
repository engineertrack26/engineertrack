import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { GroupContextLabel, GroupModal, groupStyles } from './GroupUI';
import { ui } from '@/components/common/workflowStyles';
import { assignmentService } from '@/services/assignments';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { newAssignmentId, prepareAssignments, type PreparedTask } from '@/utils/assignmentPreparation';
import type { GroupAssignment, KpiTriplet } from '@/types/assignment';

export function AssignmentReview({ groupId, createdBy, triplets, dueDate, memberCount, onClose, onDone, onPublish }: {
  groupId: string; createdBy: string; triplets: KpiTriplet[]; dueDate: string; memberCount: number;
  onClose: () => void; onDone: () => void;
  onPublish: (rows: GroupAssignment[]) => Promise<boolean>;
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
  const running = useRef(false);
  const snapshot = useRef<PreparedTask[] | null>(null);

  function change(id: string, patch: Partial<PreparedTask>) {
    setTasks((old) => old.map((task) => task.id === id ? { ...task, ...patch } : task));
  }

  function changeDate(value: string) {
    setBatchDate(value);
    setTasks((old) => old.map((task) => ({ ...task, dueDate: value || undefined })));
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
    setFailed(false);
    // Freeze after the first attempt: retry must recover the exact rows, not
    // silently overwrite a task another session may already have published.
    snapshot.current ??= tasks.map((a) => ({ ...a, title: a.title.trim(),
      objective: a.objective.trim(), criterion: a.criterion.trim(), description: a.description?.trim() }));
    try {
      const rows = await prepareAssignments(snapshot.current, assignmentService);
      if (useAuthStore.getState().user?.id !== createdBy) throw new Error('Session changed');
      if (send) {
        if (!await onPublish(rows)) { setFailed(true); return; }
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
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.primaryText}>{t('taskFlow.send', { count: tasks.length })}</Text>}
    </TouchableOpacity>
    <TouchableOpacity style={groupStyles.outline} accessibilityRole="button" disabled={busy} onPress={() => finish(false)}>
      <Text style={groupStyles.linkText}>{t('taskFlow.saveDraft')}</Text>
    </TouchableOpacity>

  </>}>
    <GroupContextLabel groupId={groupId} />
    <Text style={ui.body}>{t('taskFlow.summary', { tasks: tasks.length, students: memberCount })}</Text>
    <TouchableOpacity style={groupStyles.outline} accessibilityRole="button" disabled={attempted || busy}
      onPress={() => setShowDate(true)}>
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
          changeDate(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`);
        }} />
      {Platform.OS === 'ios' && <TouchableOpacity accessibilityRole="button" onPress={() => setShowDate(false)}>
        <Text style={ui.link}>{t('common.done')}</Text>
      </TouchableOpacity>}
    </View>}
    <Text style={ui.secondary}>{t('taskFlow.reviewHint')}</Text>
    {failed && <View style={ui.note}><Text accessibilityRole="alert" style={ui.body}>{t('taskFlow.retryHint')}</Text></View>}
    {tasks.map((task, index) => <View key={task.id} style={ui.card}>
      <Text style={ui.cardTitle}>{index + 1}. {task.title}</Text>
      {(['objective', 'criterion'] as const).map((field) => <View key={field}>
        <Text style={ui.label}>{t(field === 'objective' ? 'advisor.assignmentObjective' : 'advisor.assignmentCriterion')}</Text>
        <Text style={ui.body}>{task[field]}</Text>
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
          return <View key={field} style={{ gap: 6 }}><Text style={ui.label}>{label}</Text>
            <TextInput accessibilityLabel={label} multiline style={ui.input} editable={!busy}
              value={task[field] || ''} onChangeText={(value) => change(task.id, { [field]: value })} />
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
  </GroupModal>;
}
