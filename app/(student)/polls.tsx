import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { pollService } from '@/services/polls';
import { gamificationService } from '@/services/gamification';
import { Poll, PollQuestion } from '@/types/poll';
import { colors, spacing, borderRadius } from '@/theme';

type Segment = 'active' | 'completed';

export default function StudentPollsScreen() {
  const user = useAuthStore((s) => s.user);

  const [segment, setSegment] = useState<Segment>('active');
  const [activePolls, setActivePolls] = useState<Poll[]>([]);
  const [completedPolls, setCompletedPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Answer mode
  const [selectedPoll, setSelectedPoll] = useState<Poll | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [active, completed] = await Promise.all([
        pollService.getActivePolls(user.id, 'student'),
        pollService.getUserResponses(user.id),
      ]);
      setActivePolls(active.filter((p) => !p.hasResponded));
      setCompletedPolls(completed);
    } catch (err) {
      console.error('Load polls error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSelectPoll = async (poll: Poll) => {
    try {
      const full = await pollService.getPollById(poll.id, user?.id);
      setSelectedPoll(full);
      setAnswers({});
    } catch (err) {
      console.error('Load poll error:', err);
      Alert.alert('Error', 'Failed to load poll.');
    }
  };

  const handleSubmit = async () => {
    if (!user || !selectedPoll) return;

    // Validate: all questions answered
    const questions = selectedPoll.questions || [];
    for (const q of questions) {
      if (answers[q.id] === undefined || answers[q.id] === '') {
        Alert.alert('Incomplete', 'Please answer all questions before submitting.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const { score } = await pollService.submitResponse(selectedPoll.id, user.id, answers);

      const isQuiz = selectedPoll.pollType === 'quiz';
      const isPerfect = score === 100;

      try {
        await gamificationService.processPollCompletion(user.id, selectedPoll.id, isQuiz, isPerfect);
      } catch (e) {
        console.warn('Gamification processing failed:', e);
      }

      let msg = 'Your response has been submitted! +15 XP';
      if (isQuiz && score !== undefined) {
        msg = `Score: ${score}%! +15 XP`;
        if (isPerfect) msg += ' + 25 XP bonus for perfect score!';
      }

      Alert.alert('Submitted!', msg);
      setSelectedPoll(null);
      setAnswers({});
      loadData();
    } catch (err) {
      console.error('Submit response error:', err);
      Alert.alert('Error', 'Failed to submit response.');
    } finally {
      setSubmitting(false);
    }
  };

  const setAnswer = (questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const renderQuestionInput = (question: PollQuestion) => {
    const currentAnswer = answers[question.id];

    if (question.questionType === 'text') {
      return (
        <TextInput
          style={styles.textInput}
          value={(currentAnswer as string) || ''}
          onChangeText={(v) => setAnswer(question.id, v)}
          placeholder="Type your answer..."
          placeholderTextColor={colors.textDisabled}
          multiline
          textAlignVertical="top"
        />
      );
    }

    if (question.questionType === 'rating') {
      const rating = (currentAnswer as number) || 0;
      return (
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((star) => (
            <TouchableOpacity
              key={star}
              onPress={() => setAnswer(question.id, star)}
              activeOpacity={0.6}
              hitSlop={4}
            >
              <Ionicons
                name={star <= rating ? 'star' : 'star-outline'}
                size={32}
                color={star <= rating ? colors.gamification.gold : colors.textDisabled}
              />
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    if (question.questionType === 'single_choice') {
      return (
        <View style={styles.optionsContainer}>
          {question.options.map((opt) => {
            const isSelected = currentAnswer === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.optionItem, isSelected && styles.optionSelected]}
                onPress={() => setAnswer(question.id, opt.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={isSelected ? colors.primary : colors.textDisabled}
                />
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {opt.optionText}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    if (question.questionType === 'multiple_choice') {
      const selected = (currentAnswer as string[]) || [];
      return (
        <View style={styles.optionsContainer}>
          {question.options.map((opt) => {
            const isChecked = selected.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.optionItem, isChecked && styles.optionSelected]}
                onPress={() => {
                  const next = isChecked
                    ? selected.filter((id) => id !== opt.id)
                    : [...selected, opt.id];
                  setAnswer(question.id, next);
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isChecked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={isChecked ? colors.primary : colors.textDisabled}
                />
                <Text style={[styles.optionText, isChecked && styles.optionTextSelected]}>
                  {opt.optionText}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    return null;
  };

  // Answer mode
  if (selectedPoll) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.answerHeader}>
          <TouchableOpacity onPress={() => setSelectedPoll(null)} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.answerHeaderTitle} numberOfLines={1}>
            {selectedPoll.title}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.answerContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Poll info */}
          <View style={styles.pollInfoCard}>
            <View style={styles.pollTypeBadge}>
              <Text style={styles.pollTypeBadgeText}>
                {selectedPoll.pollType.toUpperCase()}
              </Text>
            </View>
            {selectedPoll.description && (
              <Text style={styles.pollDescription}>{selectedPoll.description}</Text>
            )}
          </View>

          {/* Questions */}
          {(selectedPoll.questions || []).map((q, i) => (
            <View key={q.id} style={styles.questionCard}>
              <Text style={styles.questionNumber}>Question {i + 1}</Text>
              <Text style={styles.questionText}>{q.questionText}</Text>
              {renderQuestionInput(q)}
            </View>
          ))}

          {/* Submit */}
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.7}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="send" size={20} color="#fff" />
                <Text style={styles.submitBtnText}>Submit</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // List mode
  const getPollTypeIcon = (type: string) => {
    switch (type) {
      case 'quiz': return 'school-outline';
      case 'survey': return 'clipboard-outline';
      case 'feedback': return 'chatbubbles-outline';
      default: return 'clipboard-outline';
    }
  };

  const getPollTypeColor = (type: string) => {
    switch (type) {
      case 'quiz': return colors.info;
      case 'survey': return colors.primary;
      case 'feedback': return colors.success;
      default: return colors.primary;
    }
  };

  const currentList = segment === 'active' ? activePolls : completedPolls;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Text style={styles.screenTitle}>Polls & Quizzes</Text>

      {/* Segment control */}
      <View style={styles.segmentControl}>
        {(['active', 'completed'] as Segment[]).map((seg) => (
          <TouchableOpacity
            key={seg}
            style={[styles.segmentBtn, segment === seg && styles.segmentBtnActive]}
            onPress={() => setSegment(seg)}
            activeOpacity={0.7}
          >
            <Text style={[styles.segmentText, segment === seg && styles.segmentTextActive]}>
              {seg === 'active' ? `Active (${activePolls.length})` : `Completed (${completedPolls.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={currentList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={currentList.length === 0 ? styles.emptyList : styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          renderItem={({ item }) => {
            const typeColor = getPollTypeColor(item.pollType);
            return (
              <TouchableOpacity
                style={styles.pollCard}
                onPress={() => segment === 'active' ? handleSelectPoll(item) : undefined}
                activeOpacity={segment === 'active' ? 0.7 : 1}
              >
                <View style={[styles.pollIconWrap, { backgroundColor: typeColor + '15' }]}>
                  <Ionicons
                    name={getPollTypeIcon(item.pollType) as keyof typeof Ionicons.glyphMap}
                    size={24}
                    color={typeColor}
                  />
                </View>
                <View style={styles.pollCardInfo}>
                  <View style={styles.pollCardTop}>
                    <Text style={styles.pollCardTitle} numberOfLines={1}>{item.title}</Text>
                    {segment === 'active' && (
                      <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>NEW</Text>
                      </View>
                    )}
                  </View>
                  {item.description && (
                    <Text style={styles.pollCardDesc} numberOfLines={1}>{item.description}</Text>
                  )}
                  <View style={styles.pollCardMeta}>
                    <View style={[styles.typeBadge, { backgroundColor: typeColor + '15' }]}>
                      <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                        {item.pollType}
                      </Text>
                    </View>
                    {item.endsAt && (
                      <Text style={styles.deadlineText}>
                        Ends {new Date(item.endsAt).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                </View>
                {segment === 'active' && (
                  <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons
                name={segment === 'active' ? 'clipboard-outline' : 'checkmark-done-outline'}
                size={64}
                color={colors.textDisabled}
              />
              <Text style={styles.emptyTitle}>
                {segment === 'active' ? 'No Active Polls' : 'No Completed Polls'}
              </Text>
              <Text style={styles.emptyText}>
                {segment === 'active'
                  ? 'New polls from your mentors will appear here.'
                  : "You haven't completed any polls yet."}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Segments
  segmentControl: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  segmentBtnActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: '#fff',
  },

  // List
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },

  // Poll Card
  pollCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  pollIconWrap: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  pollCardInfo: {
    flex: 1,
  },
  pollCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pollCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  pollCardDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  pollCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  newBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  deadlineText: {
    fontSize: 11,
    color: colors.textDisabled,
  },

  // Answer mode
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  answerHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  answerContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  pollInfoCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pollTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  pollTypeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  pollDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  // Questions
  questionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  questionNumber: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  questionText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
    lineHeight: 22,
  },

  // Inputs
  textInput: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.text,
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionsContainer: {
    gap: spacing.xs,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSelected: {
    backgroundColor: colors.primary + '08',
    borderColor: colors.primary + '40',
  },
  optionText: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  optionTextSelected: {
    fontWeight: '600',
    color: colors.primary,
  },

  // Submit
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 20,
  },
});
