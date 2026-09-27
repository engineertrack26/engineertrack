import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { quizService } from '@/services/quizzes';
import { RpcError } from '@/services/rpcError';
import { groupService } from '@/services/group';
import { useAuthStore } from '@/store/authStore';
import { quizDraftError, MAX_QUIZ_OPTIONS, MAX_QUIZ_QUESTIONS } from '@/utils/quiz';
import type { GroupMember } from '@/types/group';
import type { QuizAudience, QuizDetail, QuizQuestion, QuizResult, QuizSummary } from '@/types/quiz';
import { QuizImage } from '@/components/quiz/QuizImage';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

const emptyQuestion = (): QuizQuestion => ({ text: '', options: ['', ''] });

export default function GroupQuizzesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const advisorId = useAuthStore(s => s.user?.id);
  const { groupId: rawGroupId } = useLocalSearchParams<{ groupId?: string }>();
  const groupId = typeof rawGroupId === 'string' ? rawGroupId : '';
  const [items, setItems] = useState<QuizSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState(false);
  const load = useCallback(async () => {
    if (!groupId) return;
    try {
      const [quizzes, groups] = await Promise.all([
        quizService.listAdvisor(groupId), advisorId ? groupService.listMyGroups(advisorId) : Promise.resolve([]),
      ]);
      setItems(quizzes); setArchived(!!groups.find(g => g.id === groupId)?.isArchived); setFailed(false);
    }
    catch (error) {
      console.warn('Advisor quizzes load failed:', error instanceof Error ? error.message : error);
      setFailed(true);
    }
    finally { setLoading(false); }
  }, [groupId, advisorId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function create() {
    if (busy || !groupId) return;
    setBusy(true);
    try { setActiveId(await quizService.init(groupId)); }
    catch (error) { Alert.alert(t('common.error'), t(error instanceof RpcError ? error.info.key : 'quiz.loadFailed')); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    {activeId ? <QuizEditor key={activeId} id={activeId} groupId={groupId} onBack={() => {
      setActiveId(null); void load();
    }} /> : <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}>
      <Pressable onPress={() => router.push({ pathname: '/(advisor)/groups', params: { groupId } })}
        accessibilityRole="button" style={ui.iconButton}>
        <Ionicons name="arrow-back" size={24} color={colors.ink} />
      </Pressable>
      <Text style={ui.title} accessibilityRole="header">{t('quiz.advisorTitle', 'Quizzes')}</Text>
      <Text style={ui.secondary}>{t('quiz.advisorHint', 'Prepare up to 10 questions and send them to the group or selected students.')}</Text>
      {!archived && <Pressable style={ui.primary} onPress={() => void create()} disabled={busy} accessibilityRole="button">
        <Text style={ui.primaryText}>{t('quiz.create', 'Create quiz')}</Text>
      </Pressable>}
      {failed && <LoadFailedBanner onRetry={() => void load()} />}
      {loading && <ActivityIndicator color={colors.primary} />}
      {!loading && !failed && items.length === 0 && <Text style={ui.secondary}>{t('quiz.noQuizzes', 'No quizzes yet.')}</Text>}
      {items.map(item => <Pressable key={item.id} style={ui.card} accessibilityRole="button"
        onPress={() => setActiveId(item.id)}>
        <Text style={ui.cardTitle}>{item.title || t('quiz.untitled', 'Untitled draft')}</Text>
        <Text style={ui.secondary}>{item.questionCount} {t('quiz.questions', 'questions')} · {item.publishedAt
          ? t('quiz.submittedCount', '{{count}} submitted', { count: item.submittedCount ?? 0 })
          : t('quiz.draft', 'Draft')}</Text>
        <Text style={ui.secondary}>{item.closedAt ? t('quiz.closed', 'Closed') : item.publishedAt
          ? t('quiz.published', 'Sent') : t('quiz.editDraft', 'Edit draft')}</Text>
      </Pressable>)}
    </ScrollView>}
  </SafeAreaView>;
}

function QuizEditor({ id, groupId, onBack }: { id: string; groupId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<QuizDetail | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [audience, setAudience] = useState<QuizAudience>('group');
  const [targets, setTargets] = useState<string[]>([]);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [datePicker, setDatePicker] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [baseline, setBaseline] = useState('');
  const lock = useRef(false);
  const savedImages = useRef<Set<string>>(new Set());
  const uploadedImages = useRef<Set<string>>(new Set());
  const current = JSON.stringify({ title, description, questions, audience, targets, endsAt });
  const dirty = !!detail && !detail.publishedAt && current !== baseline;

  const load = useCallback(async () => {
    try {
      const quiz = await quizService.detail(id);
      if (quiz.groupId !== groupId) throw new Error('Wrong group');
      const [people, rows] = await Promise.all([
        quiz.publishedAt ? Promise.resolve([]) : groupService.listMembers(groupId),
        quiz.publishedAt ? quizService.results(id) : Promise.resolve([]),
      ]);
      setDetail(quiz); setMembers(people); setResults(rows);
      setTitle(quiz.title); setDescription(quiz.description);
      setQuestions(quiz.questions); setAudience(quiz.audience); setTargets(quiz.targets);
      setEndsAt(quiz.endsAt);
      savedImages.current = new Set(quiz.questions.map(q => q.imagePath).filter((path): path is string => !!path));
      setBaseline(JSON.stringify({ title: quiz.title, description: quiz.description,
        questions: quiz.questions, audience: quiz.audience, targets: quiz.targets, endsAt: quiz.endsAt }));
      setFailed(false);
    } catch (error) {
      console.warn('Quiz detail load failed:', error instanceof Error ? error.message : error);
      setFailed(true);
    }
    finally { setLoading(false); }
  }, [id, groupId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  function back() {
    if (!dirty) { onBack(); return; }
    Alert.alert(t('quiz.unsaved', 'Unsaved changes'), t('quiz.discardConfirm', 'Discard changes to this draft?'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('quiz.discard', 'Discard'), style: 'destructive', onPress: () => void (async () => {
        for (const path of uploadedImages.current) {
          try { await quizService.removeImage(path); } catch { /* The draft remains private. */ }
        }
        onBack();
      })() },
    ]);
  }
  function updateQuestion(index: number, value: QuizQuestion) {
    setQuestions(prev => prev.map((question, i) => i === index ? value : question));
  }
  async function save(showSuccess = true): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true; setBusy(true);
    try {
      await quizService.save(id, { title, description, questions, audience,
        targets: audience === 'selected' ? targets : [], endsAt });
      const desired = new Set(questions.map(q => q.imagePath).filter((path): path is string => !!path));
      const stale = [...new Set([...savedImages.current, ...uploadedImages.current])].filter(path => !desired.has(path));
      savedImages.current = desired;
      uploadedImages.current.clear();
      for (const path of stale) {
        try { await quizService.removeImage(path); } catch { /* No dangling reference; cleanup can be retried. */ }
      }
      setBaseline(current);
      if (showSuccess) Alert.alert(t('common.done'), t('quiz.saved', 'Draft saved.'));
      return true;
    } catch (error) {
      Alert.alert(t('common.error'), t(error instanceof RpcError ? error.info.key : 'quiz.saveFailed'));
      console.warn('Quiz save failed:', error instanceof Error ? error.message : error);
      return false;
    } finally { lock.current = false; setBusy(false); }
  }
  async function publish() {
    const errorKey = quizDraftError(title, questions);
    if (errorKey) { Alert.alert(t('common.error'), t(errorKey)); return; }
    if (audience === 'selected' && targets.length === 0) {
      Alert.alert(t('common.error'), t('quiz.targetsRequired', 'Select at least one student.')); return;
    }
    if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
      Alert.alert(t('common.error'), t('quiz.deadlinePast', 'Choose a future deadline.')); return;
    }
    Alert.alert(t('quiz.send', 'Send quiz'), t('quiz.sendConfirm', 'Send this quiz now? Questions cannot be changed after sending.'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('quiz.send', 'Send quiz'), onPress: () => void (async () => {
        if (!(await save(false))) return;
        setBusy(true);
        try {
          const count = await quizService.publish(id);
          Alert.alert(t('common.done'), t('quiz.sentCount', 'Quiz sent to {{count}} students.', { count }));
          await load();
        } catch (error) { Alert.alert(t('common.error'), t(error instanceof RpcError ? error.info.key : 'quiz.publishFailed')); }
        finally { setBusy(false); }
      })() },
    ]);
  }
  async function addImage(index: number) {
    if (busy) return;
    try {
      const chosen = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
      if (chosen.canceled || !chosen.assets[0]) return;
      const asset = chosen.assets[0];
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert(t('common.error'), t('quiz.imageTooLarge', 'Choose an image under 5 MB.')); return;
      }
      const mime = asset.mimeType ?? (asset.fileName?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        Alert.alert(t('common.error'), t('quiz.imageType', 'Choose a JPEG, PNG or WebP image.')); return;
      }
      setBusy(true);
      const path = await quizService.uploadImage(id, asset.uri, mime);
      uploadedImages.current.add(path);
      setQuestions(prev => prev.map((q, i) => i === index ? { ...q, imagePath: path } : q));
    } catch { Alert.alert(t('common.error'), t('quiz.imageFailed', 'Could not upload image. Try again.')); }
    finally { setBusy(false); }
  }
  async function deleteDraft() {
    if (busy) return;
    setBusy(true);
    try {
      const imagePaths = [...new Set([...savedImages.current, ...uploadedImages.current])];
      for (const path of imagePaths) await quizService.removeImage(path);
      await quizService.removeDraft(id);
      onBack();
    } catch (error) { Alert.alert(t('common.error'), t(error instanceof RpcError ? error.info.key : 'quiz.deleteFailed')); }
    finally { setBusy(false); }
  }
  function confirmDelete() {
    Alert.alert(t('quiz.delete', 'Delete draft'), t('quiz.deleteConfirm', 'Delete this draft permanently?'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('quiz.delete', 'Delete draft'), style: 'destructive', onPress: () => void deleteDraft() },
    ]);
  }
  async function close() {
    if (busy) return;
    setBusy(true);
    try { await quizService.close(id); await load(); }
    catch (error) { Alert.alert(t('common.error'), t(error instanceof RpcError ? error.info.key : 'quiz.closeFailed')); }
    finally { setBusy(false); }
  }
  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
  if (failed || !detail) return <View style={ui.content}>
    <Pressable onPress={onBack} style={ui.iconButton}><Ionicons name="arrow-back" size={24} color={colors.ink} /></Pressable>
    <LoadFailedBanner onRetry={() => void load()} />
  </View>;
  const published = !!detail.publishedAt;
  const ended = !!detail.closed;
  const submitted = results.filter(row => !!row.submittedAt);
  return <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
    <Pressable onPress={back} style={ui.iconButton} accessibilityRole="button">
      <Ionicons name="arrow-back" size={24} color={colors.ink} />
    </Pressable>
    <Text style={ui.title} accessibilityRole="header">{published ? detail.title : t('quiz.editDraft', 'Edit draft')}</Text>
    {published ? <>
      <Text style={ui.secondary}>{ended ? t('quiz.closed', 'Closed') : t('quiz.published', 'Sent')}
        {' · '}{submitted.length} / {results.length} {t('quiz.submitted', 'submitted')}</Text>
      {!ended && <Pressable style={ui.primary} onPress={() => Alert.alert(t('quiz.close', 'Close quiz'),
        t('quiz.closeConfirm', 'Close this quiz and release results? Students can no longer answer.'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('quiz.close', 'Close quiz'), onPress: () => void close() },
        ])}><Text style={ui.primaryText}>{t('quiz.close', 'Close quiz')}</Text></Pressable>}
      <Text style={ui.section}>{t('quiz.results', 'Results')}</Text>
      {results.map(row => <View key={row.studentId} style={ui.card}>
        <Text style={ui.label}>{row.name}</Text>
        <Text style={ui.secondary}>{row.submittedAt ? `${row.score} / ${questions.length}` : t('quiz.notSubmitted', 'Not submitted')}</Text>
      </View>)}
      {submitted.length > 0 && <View style={ui.card}>
        <Text style={ui.cardTitle}>{t('quiz.questionAnalysis', 'Question analysis')}</Text>
        {questions.map((q, i) => <Text key={i} style={ui.body}>{i + 1}. {q.text}: {' '}
          {submitted.filter(row => row.answers?.[String(i)] === q.correct).length} / {submitted.length} {t('quiz.correct', 'correct')}</Text>)}
      </View>}
      {questions.map((q, i) => <View key={i} style={ui.card}>
        <Text style={ui.cardTitle}>{i + 1}. {q.text}</Text>
        {!!q.imagePath && <QuizImage path={q.imagePath} />}
        {q.options.map((option, j) => <Text key={j} style={ui.body}>{j === q.correct ? '✓ ' : '  '}{option}</Text>)}
      </View>)}
    </> : <>
      <Text style={ui.secondary}>{t('quiz.draftHint', 'Save your draft, preview it, then send it when ready.')}</Text>
      <Text style={ui.label}>{t('quiz.title', 'Title')}</Text>
      <TextInput style={ui.input} value={title} maxLength={120} onChangeText={setTitle}
        placeholder={t('quiz.titlePlaceholder', 'Quiz title')} accessibilityLabel={t('quiz.title', 'Title')} />
      <Text style={ui.label}>{t('quiz.description', 'Description (optional)')}</Text>
      <TextInput style={[ui.input, { minHeight: 80 }]} value={description} maxLength={1000}
        onChangeText={setDescription} multiline placeholder={t('quiz.descriptionPlaceholder', 'What is this quiz about?')} />
      <Text style={ui.label}>{t('quiz.deadline', 'Deadline (optional)')}</Text>
      <Pressable style={ui.card} onPress={() => setDatePicker(true)} accessibilityRole="button">
        <Text style={ui.body}>{endsAt ? new Date(endsAt).toLocaleDateString() : t('quiz.noDeadline', 'No deadline')}</Text>
      </Pressable>
      {endsAt && <Pressable onPress={() => setEndsAt(null)}><Text style={ui.link}>{t('quiz.removeDeadline', 'Remove deadline')}</Text></Pressable>}
      {datePicker && <DateTimePicker value={endsAt ? new Date(endsAt) : new Date()} mode="date"
        minimumDate={new Date()} onChange={(_event, date) => {
          setDatePicker(false);
          if (date) { date.setHours(23, 59, 59, 999); setEndsAt(date.toISOString()); }
        }} />}
      <Text style={ui.section}>{t('quiz.recipients', 'Recipients')}</Text>
      {(['group', 'selected'] as const).map(value => <Pressable key={value} style={ui.card}
        accessibilityRole="radio" accessibilityState={{ checked: audience === value }} onPress={() => setAudience(value)}>
        <Text style={ui.body}>{audience === value ? '◉' : '○'} {t(value === 'group' ? 'quiz.wholeGroup' : 'quiz.selectedStudents',
          value === 'group' ? 'Whole group' : 'Selected students')}</Text>
      </Pressable>)}
      {audience === 'selected' && <View style={ui.card}>
        {members.length === 0 && <Text style={ui.secondary}>{t('quiz.noStudents', 'No students in this group.')}</Text>}
        {members.map(person => <Pressable key={person.id} onPress={() => setTargets(prev => prev.includes(person.id)
          ? prev.filter(x => x !== person.id) : [...prev, person.id])}
          accessibilityRole="checkbox" accessibilityState={{ checked: targets.includes(person.id) }}
          style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={ui.body}>{targets.includes(person.id) ? '☑' : '☐'} {person.firstName} {person.lastName}</Text>
        </Pressable>)}
      </View>}
      <Text style={ui.section}>{t('quiz.questionsHeading', 'Questions')} ({questions.length}/{MAX_QUIZ_QUESTIONS})</Text>
      {questions.map((q, i) => <View key={i} style={ui.card}>
        <Text style={ui.cardTitle}>{t('quiz.questionNumber', 'Question {{count}}', { count: i + 1 })}</Text>
        <TextInput style={[ui.input, { minHeight: 76 }]} multiline maxLength={500}
          value={q.text} onChangeText={text => updateQuestion(i, { ...q, text })}
          placeholder={t('quiz.questionPlaceholder', 'Write the question')} />
        {!!q.imagePath && <QuizImage path={q.imagePath} />}
        <Pressable onPress={() => void addImage(i)} disabled={busy} accessibilityRole="button">
          <Text style={ui.link}>{q.imagePath ? t('quiz.replaceImage', 'Replace image') : t('quiz.addImage', 'Add image')}</Text>
        </Pressable>
        {!!q.imagePath && <Pressable onPress={() => updateQuestion(i, { ...q, imagePath: undefined })}>
          <Text style={ui.link}>{t('quiz.removeImage', 'Remove image')}</Text>
        </Pressable>}
        <Text style={ui.secondary}>{t('quiz.markCorrect', 'Choose the correct answer')}</Text>
        {q.options.map((option, j) => <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => updateQuestion(i, { ...q, correct: j })}
            accessibilityRole="radio" accessibilityState={{ checked: q.correct === j }} style={ui.iconButton}>
            <Ionicons name={q.correct === j ? 'radio-button-on' : 'radio-button-off'} size={24} color={colors.primary} />
          </Pressable>
          <TextInput style={[ui.input, { flex: 1 }]} maxLength={200} value={option}
            onChangeText={text => updateQuestion(i, { ...q, options: q.options.map((x, k) => k === j ? text : x) })}
            placeholder={t('quiz.optionNumber', 'Option {{count}}', { count: j + 1 })} />
          {q.options.length > 2 && <Pressable onPress={() => updateQuestion(i, {
            ...q, options: q.options.filter((_, k) => k !== j),
            correct: q.correct === j ? undefined : q.correct !== undefined && q.correct > j ? q.correct - 1 : q.correct,
          })} style={ui.iconButton} accessibilityLabel={t('quiz.removeOption', 'Remove option')}>
            <Ionicons name="close-circle-outline" size={22} color={colors.error} />
          </Pressable>}
        </View>)}
        {q.options.length < MAX_QUIZ_OPTIONS && <Pressable onPress={() => updateQuestion(i, { ...q, options: [...q.options, ''] })}>
          <Text style={ui.link}>{t('quiz.addOption', 'Add option')}</Text>
        </Pressable>}
        <Pressable onPress={() => setQuestions(prev => prev.filter((_, j) => j !== i))}>
          <Text style={[ui.link, { color: colors.error }]}>{t('quiz.removeQuestion', 'Remove question')}</Text>
        </Pressable>
      </View>)}
      {questions.length < MAX_QUIZ_QUESTIONS && <Pressable style={ui.card}
        onPress={() => setQuestions(prev => [...prev, emptyQuestion()])} accessibilityRole="button">
        <Text style={ui.link}>{t('quiz.addQuestion', 'Add question')}</Text>
      </Pressable>}
      <Pressable onPress={() => setPreview(value => !value)}><Text style={ui.link}>{t('quiz.preview', 'Preview')}</Text></Pressable>
      {preview && questions.map((q, i) => <View key={i} style={ui.card}>
        <Text style={ui.cardTitle}>{i + 1}. {q.text || '…'}</Text>
        {!!q.imagePath && <QuizImage path={q.imagePath} />}
        {q.options.map((option, j) => <Text style={ui.body} key={j}>{j === q.correct ? '✓ ' : '○ '}{option || '…'}</Text>)}
      </View>)}
      <Pressable style={ui.primary} onPress={() => void save()} disabled={busy} accessibilityRole="button">
        <Text style={ui.primaryText}>{t('quiz.saveDraft', 'Save draft')}</Text>
      </Pressable>
      <Pressable style={ui.primary} onPress={() => void publish()} disabled={busy} accessibilityRole="button">
        <Text style={ui.primaryText}>{t('quiz.send', 'Send quiz')}</Text>
      </Pressable>
      <Pressable onPress={confirmDelete} disabled={busy}><Text style={[ui.link, { color: colors.error }]}>{t('quiz.delete', 'Delete draft')}</Text></Pressable>
    </>}
  </ScrollView>;
}
