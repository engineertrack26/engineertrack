import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { taskContent } from '@/utils/taskContent';
import { competencyContent } from '@/utils/competencyContent';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { assignmentService } from '@/services/assignments';
import { feedService } from '@/services/feed';
import { groupService } from '@/services/group';
import { taskDraftStore } from '@/services/taskDrafts';
import { DOCUMENT_BUCKET, PHOTO_BUCKET, extractStoragePath, signEvidence } from '@/services/evidenceUrls';
import { TaskDraft, draftRevision, submissionDraft } from '@/utils/taskDrafts';
import { isActionable, taskDueDate } from '@/utils/studentTasks';
import { mapRpcError } from '@/utils/rpcErrors';
import { useClosureStatus } from '@/hooks/useClosureStatus';
import { EvidencePicker } from '@/components/forms';
import { ClosureBanner, LevelPicker, LoadFailedBanner } from '@/components/common';
import { levelLabel } from '@/utils/selfAssessment';
import { TaskStatus, ui } from '@/components/student/StudentUI';
import { colors } from '@/theme';
import type { MyAssignment } from '@/types/assignment';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
/** Simulation finding #10: the server refuses shorter reflections (REFLECTION_TOO_SHORT). */
const REFLECTION_MIN = 20;

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const userId = useAuthStore(s => s.user?.id);
  return <TaskDetail key={userId + '/' + id} id={id} userId={userId} />;
}

function TaskDetail({ id, userId }: { id?: string; userId?: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [task, setTask] = useState<MyAssignment | null>(null);
  const [draft, setDraft] = useState<TaskDraft>({ note: '', reflection: '', photos: [], documents: [], selfLevel: null });
  const currentDraft = useRef(draft);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [reflectionError, setReflectionError] = useState(false);
  const [levelError, setLevelError] = useState(false);
  // Per-task, default on (spec decision 2). Not part of TaskDraft on purpose
  // -- see the Task 5 brief. Seeded from the server on load; sent as a
  // second call after submit_assignment returns.
  const [shareToFeed, setShareToFeed] = useState(true);
  const [sharingBusy, setSharingBusy] = useState(false);
  const sharingInFlight = useRef(false);
  const reflectionInput = useRef<TextInput>(null);
  const generation = useRef(0);
  const saveVersion = useRef(0);
  const busy = useRef(false);
  busy.current = uploading || submitting;
  const { status: closure } = useClosureStatus(userId, task?.groupId);
  const actionable = !!task && isActionable(task) && !closure?.closed;

  const load = useCallback(async () => {
    const request = ++generation.current;
    saveVersion.current++;
    setLoading(true);
    setFailed(false);
    setRestoreFailed(false);
    setSaveState('idle');
    try {
      if (!id || !userId) { setTask(null); return; }
      const group = await groupService.getMyGroup(userId);
      const items = group ? await assignmentService.listMyAssignments(group.id, userId, id) : [];
      const item = items[0];
      if (request !== generation.current) return;
      if (!item) { setTask(null); return; }
      let value = submissionDraft(item);
      let restored = false;
      if (isActionable(item)) {
        try {
          const saved = await taskDraftStore.load(userId, id, draftRevision(item));
          if (saved) { value = { ...saved, ...await signEvidence(saved.photos, saved.documents) }; restored = true; }
        } catch {
          if (request === generation.current) setRestoreFailed(true);
        }
      }
      if (request !== generation.current) return;
      currentDraft.current = value;
      setDraft(value);
      setTask(item);
      if (!sharingInFlight.current) setShareToFeed(item.submission?.shareToFeed ?? true);
      setSaveState(restored ? 'saved' : 'idle');
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [id, userId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; saveVersion.current++; };
  }, [load]));

  const goBack = useCallback(() => {
    if (saveState === 'saving') {
      Alert.alert(t('common.loading'), t('studentFlow.draftSaving'));
      return;
    }
    if (busy.current) {
      Alert.alert(t('common.loading'), t('student.waitForUploads'));
      return;
    }
    if (saveState === 'error' || restoreFailed) {
      Alert.alert(t('common.error'), t('studentFlow.leaveUnsaved'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.back'), onPress: () => router.replace('/(student)/my-tasks') },
      ]);
      return;
    }
    router.replace('/(student)/my-tasks');
  }, [router, saveState, restoreFailed, t]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    return () => subscription.remove();
  }, [goBack]));

  async function persist(value: TaskDraft) {
    if (!task || !userId || !id) return;
    const version = ++saveVersion.current;
    setSaveState('saving');
    try {
      await taskDraftStore.save(userId, id, draftRevision(task), {
        ...value,
        photos: value.photos.map(p => ({ ...p, uri: extractStoragePath(p.uri, PHOTO_BUCKET) || p.uri })),
        documents: value.documents.map(d => ({ ...d, uri: extractStoragePath(d.uri, DOCUMENT_BUCKET) || d.uri })),
      });
      if (version === saveVersion.current) setSaveState('saved');
    } catch {
      if (version === saveVersion.current) setSaveState('error');
    }
  }

  function edit(change: Partial<TaskDraft>) {
    const value = { ...currentDraft.current, ...change };
    currentDraft.current = value;
    setDraft(value);
    void persist(value);
  }

  async function openDocument(uri?: string) {
    if (!uri) { Alert.alert(t('common.error'), t('common.tryAgain')); return; }
    try { await Linking.openURL(uri); }
    catch { Alert.alert(t('common.error'), t('common.tryAgain')); }
  }

  async function changeSharing(share: boolean) {
    if (!task?.submission || sharingBusy) return;
    const previous = shareToFeed;
    setShareToFeed(share);           // optimistic
    setSharingBusy(true);
    sharingInFlight.current = true;
    try {
      await feedService.setSubmissionSharing(task.submission.id, share);
      setTask(current => current && current.submission
        ? { ...current, submission: { ...current.submission, shareToFeed: share } }
        : current);
      // Re-assert from the confirmed value: a load() may have re-seeded
      // shareToFeed from a stale fetch while this RPC was in flight.
      setShareToFeed(share);
    } catch (error) {
      setShareToFeed(previous);
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      Alert.alert(t('common.error'), t(mapRpcError(message).key));
    } finally {
      setSharingBusy(false);
      sharingInFlight.current = false;
    }
  }

  async function submit() {
    if (!task || !userId || !id || busy.current || !actionable || restoreFailed) return;
    if (currentDraft.current.reflection.trim().length < REFLECTION_MIN) {
      setReflectionError(true);
      reflectionInput.current?.focus();
      return;
    }
    if (!currentDraft.current.photos.length && !currentDraft.current.documents.length) {
      Alert.alert(t('common.error'), t('errors.evidenceRequired', 'Add at least one photo or document before submitting.'));
      return;
    }
    if (currentDraft.current.selfLevel === null) {
      setLevelError(true);
      return;
    }
    busy.current = true;
    setSubmitting(true);
    try {
      const latest = (await assignmentService.listMyAssignments(task.groupId, userId, id))[0];
      if (!latest || draftRevision(latest) !== draftRevision(task)) {
        Alert.alert(t('common.error'), t('studentFlow.taskChanged'));
        return;
      }
      const value = currentDraft.current;
      const submissionId = await assignmentService.submitAssignment(id, value.note.trim(), value.reflection.trim(), value.photos, value.documents, value.selfLevel ?? undefined);
      // The sharing decision travels as a second call, not a sixth RPC
      // parameter (spec §3). It must not fail silently: a task shared
      // against the student's wish is the one outcome the switch exists to
      // prevent, so a failure is told to them, with where to fix it.
      // The call is made whenever the switch differs from what the server
      // holds, not only when it is off: a resubmission after a revision
      // request keeps the row's share_to_feed (submit_assignment's ON
      // CONFLICT never touches it), so an off -> on flip would otherwise
      // never reach the server and approval would post nothing.
      let sharingFailed = false;
      const serverShare = task.submission?.shareToFeed ?? true;
      if (shareToFeed !== serverShare) {
        try {
          await feedService.setSubmissionSharing(submissionId, shareToFeed);
        } catch (error) {
          sharingFailed = true;
          console.warn('Sharing update failed:', error instanceof Error ? error.message : error);
        }
      }
      // Local cleanup failure must not turn a successful server submit into a
      // false failure / duplicate retry. Revision matching rejects this draft.
      try { await taskDraftStore.remove(userId, id); } catch { /* stale draft is ignored on next read */ }
      // One dialog either way: a sharing-update failure is folded into the
      // success alert instead of stacking a second one on top of it.
      Alert.alert(t('common.done'), sharingFailed
        ? t('student.taskSubmitted') + '\n\n' + t('student.sharingUpdateFailed')
        : t('student.taskSubmitted'));
      router.replace('/(student)/my-tasks');
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      Alert.alert(t('common.error'), t(mapRpcError(message).key));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  const due = taskDueDate(task?.dueDate, i18n.language);
  const rated = typeof task?.submission?.selfLevel === 'number' && typeof task?.submission?.mentorLevel === 'number';
  const facts = task ? [
    task.competencyName && { label: t('dash.competency', 'Competency'), value: `${competencyContent(task.competencyName, i18n.language)}${task.level ? ' · L' + task.level : ''}` },
    due && { label: t('student.taskDueDate'), value: due },
    rated && { label: `${t('assessment.you', 'You')} / ${t('assessment.mentor', 'Mentor')}`,
      value: `${levelLabel(task.submission!.selfLevel!, t)} / ${levelLabel(task.submission!.mentorLevel!, t)}` },
  ].filter((f): f is { label: string; value: string } => !!f) : [];
  const gapNote = rated && task!.submission!.mentorLevel! > task!.submission!.selfLevel! ? t('assessment.theySawMore', 'Your mentor saw more')
    : rated && task!.submission!.mentorLevel! < task!.submission!.selfLevel! ? t('assessment.theySawLess', 'Your mentor saw less') : '';
  return <SafeAreaView style={ui.safe}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <View style={[ui.header, { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={t('student.myTasks')}
            style={[ui.header, { minHeight: 48 }]}>
            <Ionicons name="chevron-back" size={24} color={colors.primaryDark} />
            <Text style={ui.link}>{t('tabs.tasks')}</Text>
          </Pressable>
          {actionable && saveState !== 'idle' && <Text accessibilityLiveRegion="polite"
            style={[ui.secondary, { color: saveState === 'error' ? colors.error : saveState === 'saved' ? colors.stamp : colors.textSecondary }]}>
            {t('studentFlow.draft' + saveState[0].toUpperCase() + saveState.slice(1))}
          </Text>}
        </View>
        <ClosureBanner status={closure} onReport={() => router.push({ pathname: '/(student)/internship-report', params: { studentId: userId, groupId: task?.groupId } })} />
        {loading ? <ActivityIndicator size="large" color={colors.primary} /> : failed ? <LoadFailedBanner onRetry={load} /> : !task ?
          <Text style={ui.body}>{t('errors.assignmentNotFound')}</Text> : <>
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="header" style={ui.title}>{taskContent(task.title, i18n.language)}</Text>
            <TaskStatus task={task} />
          </View>
          {facts.length > 0 && <View style={{ gap: 6, paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.rule }}>
            {facts.map((f) => <View key={f.label} style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[ui.secondary, { width: 96 }]}>{f.label}</Text>
              <Text style={[ui.body, { flex: 1, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] }]}>{f.value}</Text>
            </View>)}
            {!!gapNote && <Text style={ui.secondary}>{gapNote}</Text>}
          </View>}
          {!!task.submission?.mentorNote && task.submission.status !== 'submitted' && <View style={ui.note}>
            <Text style={ui.label}>{t('studentFlow.mentorNote')}</Text>
            <Text style={ui.body}>{task.submission.mentorNote}</Text>
          </View>}
          <View style={{ gap: 8 }}>
            <Text style={ui.section}>{t('student.taskCriterion')}</Text>
            <Text style={ui.body}>{taskContent(task.criterion, i18n.language, 'criterion')}</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: instructions }} onPress={() => setInstructions(!instructions)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }}>
              <Text style={[ui.link, { paddingVertical: 0 }]}>{t('studentFlow.instructions')}</Text>
              <Ionicons name={instructions ? 'chevron-up' : 'chevron-down'} size={18} color={colors.ink} />
            </Pressable>
            {instructions && <View style={{ gap: 8, paddingLeft: 12, borderLeftWidth: 2, borderColor: colors.rule }}>
              <Text style={ui.label}>{t('student.taskObjective')}</Text><Text style={ui.body}>{taskContent(task.objective, i18n.language, 'objective')}</Text>
              {!!task.description && <Text style={ui.body}>{task.description}</Text>}
              {!!task.documentPath && <Pressable accessibilityRole="button" onPress={() => openDocument(task.documentUrl)}>
                <Text style={ui.link}>{task.documentName || t('student.taskDocument')} ↗</Text>
              </Pressable>}
            </View>}
          </View>
          {restoreFailed && <View style={ui.note}>
            <Text style={ui.body}>{t('studentFlow.restoreFailed')}</Text>
            <Pressable accessibilityRole="button" onPress={load}><Text style={ui.link}>{t('common.retry')}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setRestoreFailed(false)}><Text style={ui.link}>{t('studentFlow.useServerCopy')}</Text></Pressable>
          </View>}
          <View style={{ gap: 10 }}>
            <Text style={ui.label}>{t('student.whatIDid')}</Text>
            {actionable ? <TextInput multiline value={draft.note} onChangeText={note => edit({ note })}
              editable={!submitting && !restoreFailed} accessibilityLabel={t('student.whatIDid')} style={[ui.input, { minHeight: 112, textAlignVertical: 'top' }]} /> :
              <Text style={ui.body}>{draft.note || '—'}</Text>}
          </View>
          <View style={{ gap: 10 }}>
            <Text style={ui.label}>{t('student.whatILearned')} {actionable ? '*' : ''}</Text>
            {actionable ? <TextInput ref={reflectionInput} multiline value={draft.reflection}
              onChangeText={reflection => { setReflectionError(false); edit({ reflection }); }}
              editable={!submitting && !restoreFailed} accessibilityLabel={t('student.whatILearned') + ', ' + t('common.required')}
              style={[ui.input, { minHeight: 112, textAlignVertical: 'top', borderColor: reflectionError ? colors.error : colors.textDisabled }]} /> :
              <Text style={ui.body}>{draft.reflection || '—'}</Text>}
            {actionable && <Text style={[ui.secondary, { fontVariant: ['tabular-nums'] }]}>{draft.reflection.trim().length} / {REFLECTION_MIN}</Text>}
            {reflectionError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{t(draft.reflection.trim() ? 'errors.reflectionTooShort' : 'errors.reflectionRequired')}</Text>}
          </View>
          <View style={{ gap: 12 }}>
            <Text style={ui.section}>{t('studentFlow.evidence')}</Text>
            {actionable && userId && id ? <EvidencePicker userId={userId} scopeId={id}
              photos={draft.photos} documents={draft.documents} onChange={(photos, documents) => edit({ photos, documents })}
              onUploadingChange={setUploading} disabled={submitting || restoreFailed} /> : <>
              {draft.photos.map((photo, index) => <View key={index} style={ui.card}>
                <Image source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 6 }}
                  accessibilityLabel={photo.caption || t('studentFlow.evidence')} />
                {!!photo.caption && <Text style={ui.body}>{photo.caption}</Text>}
              </View>)}
              {draft.documents.map((doc, index) => <Pressable key={index} accessibilityRole="button" onPress={() => openDocument(doc.uri)} style={ui.card}>
                <Text style={ui.link}>{doc.fileName} ↗</Text>
              </Pressable>)}
              {!draft.photos.length && !draft.documents.length && <Text style={ui.secondary}>{t('studentFlow.noEvidence')}</Text>}
            </>}
          </View>
          {actionable && <Text style={ui.secondary}>{t('studentFlow.localDraft')}</Text>}
          {!closure?.closed && (actionable || task.submission?.status === 'approved') && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.rule }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={ui.label}>{t('student.shareToFeed')}</Text>
              <Text style={ui.secondary}>{t('student.shareToFeedHint')}</Text>
            </View>
            <Switch
              value={shareToFeed}
              onValueChange={actionable ? setShareToFeed : changeSharing}
              disabled={submitting || sharingBusy || restoreFailed}
              accessibilityLabel={t('student.shareToFeed')}
              trackColor={{ true: colors.ink }}
            />
          </View>}
          {saveState === 'error' && <Pressable accessibilityRole="button" onPress={() => persist(currentDraft.current)}>
            <Text style={ui.link}>{t('common.retry')}</Text>
          </Pressable>}
        </>}
      </ScrollView>
      {!loading && !failed && actionable && <View style={{ borderTopWidth: 1, borderColor: colors.divider, backgroundColor: colors.paper }}>
        <View style={[ui.content, { paddingVertical: 12, gap: 8 }]}>
          <View style={levelError ? { borderWidth: 1, borderColor: colors.error, borderRadius: 6, padding: 8 } : undefined}>
            <LevelPicker label={t('assessment.selfQuestion', 'How did you do this task?')}
              value={draft.selfLevel} disabled={submitting || restoreFailed}
              onChange={(selfLevel) => { setLevelError(false); edit({ selfLevel }); }} />
          </View>
          {levelError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{t('errors.selfLevelRequired')}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting || uploading || restoreFailed, busy: submitting }}
            disabled={submitting || uploading || restoreFailed} onPress={submit}
            style={[ui.primary, (submitting || uploading || restoreFailed) && { opacity: 0.6 }]}>
            {submitting && <ActivityIndicator color="#fff" />}
            <Text style={ui.primaryText}>{t('studentFlow.submitReview')}</Text>
          </Pressable>
          <Text style={[ui.secondary, { textAlign: 'center' }]}>{t(uploading ? 'student.waitForUploads' : 'studentFlow.reviewHint')}</Text>
        </View>
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
