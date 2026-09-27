import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { quizService } from '@/services/quizzes';
import { RpcError } from '@/services/rpcError';
import { quizAnswersComplete } from '@/utils/quiz';
import type { QuizDetail } from '@/types/quiz';
import { QuizImage } from '@/components/quiz/QuizImage';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

export default function QuizDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = typeof rawId === 'string' ? rawId : '';
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async () => {
    if (!id) { setFailed(true); setLoading(false); return; }
    try {
      const value = await quizService.detail(id);
      setQuiz(value); setAnswers(value.answers ?? {}); setFailed(false);
    } catch (error) {
      console.warn('Student quiz detail load failed:', error instanceof Error ? error.message : error);
      setFailed(true);
    }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function choose(index: number, option: number) {
    if (!quiz || quiz.closed || quiz.submittedAt || lock.current) return;
    const next = { ...answers, [index]: option };
    const previous = answers;
    setAnswers(next); lock.current = true; setBusy(true);
    try { await quizService.saveAnswers(id, next, false); }
    catch (error) {
      setAnswers(previous);
      Alert.alert(t('common.error'), t(error instanceof RpcError ? error.info.key : 'quiz.answerSaveFailed'));
    } finally { lock.current = false; setBusy(false); }
  }
  async function submit() {
    if (!quiz || !quizAnswersComplete(answers, quiz.questions) || lock.current) {
      Alert.alert(t('common.error'), t('quiz.incomplete', 'Answer every question before submitting.'));
      return;
    }
    Alert.alert(t('quiz.submit', 'Submit quiz'), t('quiz.submitConfirm', 'Submit now? You cannot change your answers afterwards.'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('quiz.submit', 'Submit quiz'), onPress: () => void (async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true);
        try {
          await quizService.saveAnswers(id, answers, true);
          await load();
          Alert.alert(t('common.done'), t('quiz.submittedMessage', 'Your answers were submitted.'));
        } catch (error) { Alert.alert(t('common.error'), t(error instanceof RpcError ? error.info.key : 'quiz.submitFailed')); }
        finally { lock.current = false; setBusy(false); }
      })() },
    ]);
  }
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}>
      <Pressable style={ui.iconButton} onPress={() => router.push('/(student)/my-quizzes')} accessibilityRole="button">
        <Ionicons name="arrow-back" size={24} color={colors.ink} />
      </Pressable>
      {failed && <LoadFailedBanner onRetry={() => void load()} />}
      {loading && <ActivityIndicator color={colors.primary} />}
      {quiz && !failed && <>
        <Text style={ui.title} accessibilityRole="header">{quiz.title}</Text>
        {!!quiz.description && <Text style={ui.body}>{quiz.description}</Text>}
        {!!quiz.endsAt && <Text style={ui.secondary}>{t('quiz.deadline', 'Deadline')}: {new Date(quiz.endsAt).toLocaleDateString()}</Text>}
        {quiz.submittedAt && <View style={ui.card}>
          <Text style={ui.label}>{quiz.closed ? `${t('quiz.result', 'Result')}: ${quiz.score} / ${quiz.questions.length}`
            : t('quiz.awaitingResult', 'Submitted · awaiting results')}</Text>
        </View>}
        {quiz.closed && !quiz.submittedAt && <Text style={ui.secondary}>{t('quiz.closed', 'Closed')}</Text>}
        {quiz.questions.map((q, index) => <View key={index} style={ui.card}>
          <Text style={ui.cardTitle}>{index + 1}. {q.text}</Text>
          {!!q.imagePath && <QuizImage path={q.imagePath} />}
          {q.options.map((option, choice) => {
            const selected = answers[String(index)] === choice;
            const correct = quiz.closed && q.correct === choice;
            return <Pressable key={choice} accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: quiz.closed || !!quiz.submittedAt || busy }}
              disabled={quiz.closed || !!quiz.submittedAt || busy} onPress={() => void choose(index, choice)}
              style={[ui.card, { minHeight: 48, borderColor: correct ? colors.success : selected ? colors.primary : colors.divider,
                backgroundColor: correct ? colors.stampBg : selected ? colors.inkBg : colors.paper }]}>
              <Text style={ui.body}>{correct ? '✓ ' : selected ? '◉ ' : '○ '}{option}</Text>
            </Pressable>;
          })}
        </View>)}
        {!quiz.closed && !quiz.submittedAt && <Pressable style={ui.primary} disabled={busy}
          onPress={() => void submit()} accessibilityRole="button">
          <Text style={ui.primaryText}>{t('quiz.submit', 'Submit quiz')}</Text>
        </Pressable>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
