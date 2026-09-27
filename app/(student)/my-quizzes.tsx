import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { quizService } from '@/services/quizzes';
import type { QuizSummary } from '@/types/quiz';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

export default function MyQuizzesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setItems(await quizService.listStudent()); setFailed(false); }
    catch (error) {
      console.warn('Student quizzes load failed:', error instanceof Error ? error.message : error);
      setFailed(true);
    }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <Pressable style={ui.iconButton} onPress={() => router.push('/(student)/my-tasks')} accessibilityRole="button">
        <Ionicons name="arrow-back" size={24} color={colors.ink} />
      </Pressable>
      <Text style={ui.title} accessibilityRole="header">{t('quiz.studentTitle', 'My quizzes')}</Text>
      <Text style={ui.secondary}>{t('quiz.studentHint', 'Answer each quiz once. Results appear after the deadline or when your advisor closes it.')}</Text>
      {failed && <LoadFailedBanner onRetry={() => void load()} />}
      {loading ? <ActivityIndicator color={colors.primary} /> : !failed && items.length === 0 ?
        <View style={ui.card}><Text style={ui.body}>{t('quiz.noQuizzes', 'No quizzes yet.')}</Text></View> : null}
      {items.map(quiz => <Pressable key={quiz.id} style={ui.card} accessibilityRole="button"
        onPress={() => router.push({ pathname: '/(student)/quiz-detail', params: { id: quiz.id } })}>
        <Text style={ui.cardTitle}>{quiz.title}</Text>
        <Text style={ui.secondary}>{quiz.questionCount} {t('quiz.questions', 'questions')}
          {quiz.endsAt ? ` · ${t('quiz.deadline', 'Deadline')}: ${new Date(quiz.endsAt).toLocaleDateString()}` : ''}</Text>
        <Text style={ui.label}>{quiz.submittedAt
          ? quiz.closed ? `${t('quiz.result', 'Result')}: ${quiz.score} / ${quiz.questionCount}` : t('quiz.awaitingResult', 'Submitted · awaiting results')
          : quiz.closed ? t('quiz.closed', 'Closed') : t('quiz.start', 'Start quiz')}</Text>
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
