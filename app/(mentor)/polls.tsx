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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { pollService } from '@/services/polls';
import { notificationService } from '@/services/notifications';
import { Poll, PollType, QuestionType } from '@/types/poll';
import { colors, spacing, borderRadius } from '@/theme';

interface QuestionDraft {
  questionText: string;
  questionType: QuestionType;
  options: string[];
  correctOptionIndex?: number;
}

type ScreenMode = 'list' | 'create' | 'results';

const POLL_TYPES: { key: PollType; label: string; icon: string }[] = [
  { key: 'quiz', label: 'Quiz', icon: 'school-outline' },
  { key: 'survey', label: 'Survey', icon: 'clipboard-outline' },
  { key: 'feedback', label: 'Feedback', icon: 'chatbubbles-outline' },
];

const QUESTION_TYPES: { key: QuestionType; label: string }[] = [
  { key: 'single_choice', label: 'Single Choice' },
  { key: 'multiple_choice', label: 'Multiple Choice' },
  { key: 'text', label: 'Text' },
  { key: 'rating', label: 'Rating (1-5)' },
];

export default function MentorPollsScreen() {
  const user = useAuthStore((s) => s.user);

  const [mode, setMode] = useState<ScreenMode>('list');
  const [myPolls, setMyPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pollType, setPollType] = useState<PollType>('survey');
  const [targetRole, setTargetRole] = useState<'student' | 'mentor' | 'all'>('student');
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [creating, setCreating] = useState(false);

  // Results
  const [resultsPoll, setResultsPoll] = useState<Poll | null>(null);
  const [resultsData, setResultsData] = useState<Awaited<ReturnType<typeof pollService.getPollResults>> | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);

  const loadPolls = useCallback(async () => {
    if (!user) return;
    try {
      const data = await pollService.getMyPolls(user.id);
      setMyPolls(data);
    } catch (err) {
      console.error('Load polls error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadPolls();
    }, [loadPolls]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPolls();
    setRefreshing(false);
  }, [loadPolls]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPollType('survey');
    setTargetRole('student');
    setQuestions([]);
  };

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      { questionText: '', questionType: 'single_choice', options: ['', ''] },
    ]);
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateQuestion = (index: number, field: string, value: unknown) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value } as QuestionDraft;
      return next;
    });
  };

  const addOption = (qIndex: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[qIndex] = { ...next[qIndex], options: [...next[qIndex].options, ''] };
      return next;
    });
  };

  const removeOption = (qIndex: number, oIndex: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      const opts = next[qIndex].options.filter((_, i) => i !== oIndex);
      next[qIndex] = { ...next[qIndex], options: opts };
      return next;
    });
  };

  const updateOption = (qIndex: number, oIndex: number, value: string) => {
    setQuestions((prev) => {
      const next = [...prev];
      const opts = [...next[qIndex].options];
      opts[oIndex] = value;
      next[qIndex] = { ...next[qIndex], options: opts };
      return next;
    });
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!title.trim()) {
      Alert.alert('Required', 'Please enter a poll title.');
      return;
    }
    if (questions.length === 0) {
      Alert.alert('Required', 'Please add at least one question.');
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.questionText.trim()) {
        Alert.alert('Required', `Question ${i + 1} text is empty.`);
        return;
      }
      if (['single_choice', 'multiple_choice'].includes(q.questionType)) {
        const validOpts = q.options.filter((o) => o.trim());
        if (validOpts.length < 2) {
          Alert.alert('Required', `Question ${i + 1} needs at least 2 options.`);
          return;
        }
      }
    }

    setCreating(true);
    try {
      await pollService.createPoll(
        {
          creatorId: user.id,
          title: title.trim(),
          description: description.trim() || undefined,
          pollType,
          targetRole,
        },
        questions.map((q, i) => ({
          questionText: q.questionText.trim(),
          questionType: q.questionType,
          sortOrder: i,
          correctOptionIndex: pollType === 'quiz' ? q.correctOptionIndex : undefined,
          options: ['single_choice', 'multiple_choice'].includes(q.questionType)
            ? q.options
                .filter((o) => o.trim())
                .map((o, j) => ({ optionText: o.trim(), sortOrder: j }))
            : [],
        })),
      );

      Alert.alert('Created!', 'Your poll has been published.');
      resetForm();
      setMode('list');
      loadPolls();
    } catch (err) {
      console.error('Create poll error:', err);
      Alert.alert('Error', 'Failed to create poll.');
    } finally {
      setCreating(false);
    }
  };

  const handleViewResults = async (poll: Poll) => {
    setResultsPoll(poll);
    setMode('results');
    setLoadingResults(true);
    try {
      const data = await pollService.getPollResults(poll.id);
      setResultsData(data);
    } catch (err) {
      console.error('Load results error:', err);
      Alert.alert('Error', 'Failed to load results.');
      setMode('list');
    } finally {
      setLoadingResults(false);
    }
  };

  const handleClosePoll = (poll: Poll) => {
    Alert.alert('Close Poll', 'Are you sure? Students will no longer be able to respond.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: async () => {
          try {
            await pollService.closePoll(poll.id);
            loadPolls();
          } catch (err) {
            console.error('Close poll error:', err);
          }
        },
      },
    ]);
  };

  // ── RESULTS VIEW ──
  if (mode === 'results' && resultsPoll) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.modeHeader}>
          <TouchableOpacity onPress={() => { setMode('list'); setResultsData(null); }} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.modeHeaderTitle} numberOfLines={1}>Results</Text>
          <View style={{ width: 24 }} />
        </View>

        {loadingResults ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : resultsData ? (
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.resultsContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Summary */}
            <View style={styles.resultsSummary}>
              <Text style={styles.resultsPollTitle}>{resultsPoll.title}</Text>
              <View style={styles.resultsStats}>
                <View style={styles.resultsStat}>
                  <Text style={styles.resultsStatValue}>{resultsData.totalResponses}</Text>
                  <Text style={styles.resultsStatLabel}>Responses</Text>
                </View>
                {resultsData.avgScore !== undefined && (
                  <View style={styles.resultsStat}>
                    <Text style={styles.resultsStatValue}>{resultsData.avgScore}%</Text>
                    <Text style={styles.resultsStatLabel}>Avg Score</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Per-question results */}
            {resultsData.questionResults.map((qr, i) => (
              <View key={qr.questionId} style={styles.questionResultCard}>
                <Text style={styles.qrNumber}>Q{i + 1}</Text>
                <Text style={styles.qrText}>{qr.questionText}</Text>

                {(qr.questionType === 'single_choice' || qr.questionType === 'multiple_choice') && (
                  <View style={styles.qrOptions}>
                    {Object.entries(qr.optionCounts).map(([optId, count]) => {
                      const pct = resultsData.totalResponses > 0
                        ? Math.round((count / resultsData.totalResponses) * 100)
                        : 0;
                      return (
                        <View key={optId} style={styles.qrOptionRow}>
                          <View style={styles.qrBarBg}>
                            <View style={[styles.qrBarFill, { width: `${pct}%` }]} />
                          </View>
                          <Text style={styles.qrOptionCount}>{count} ({pct}%)</Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {qr.questionType === 'rating' && qr.avgRating !== undefined && (
                  <View style={styles.qrRating}>
                    <Ionicons name="star" size={20} color={colors.gamification.gold} />
                    <Text style={styles.qrRatingText}>{qr.avgRating} / 5</Text>
                  </View>
                )}

                {qr.questionType === 'text' && qr.textAnswers.length > 0 && (
                  <View style={styles.qrTextAnswers}>
                    {qr.textAnswers.slice(0, 5).map((answer, j) => (
                      <Text key={j} style={styles.qrTextAnswer}>"{answer}"</Text>
                    ))}
                    {qr.textAnswers.length > 5 && (
                      <Text style={styles.qrMoreText}>
                        +{qr.textAnswers.length - 5} more responses
                      </Text>
                    )}
                  </View>
                )}
              </View>
            ))}

            <View style={{ height: spacing.xl }} />
          </ScrollView>
        ) : null}
      </SafeAreaView>
    );
  }

  // ── CREATE VIEW ──
  if (mode === 'create') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.modeHeader}>
          <TouchableOpacity onPress={() => { setMode('list'); resetForm(); }} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.modeHeaderTitle}>Create Poll</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.createContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Title */}
            <Text style={styles.inputLabel}>Title *</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Enter poll title..."
              placeholderTextColor={colors.textDisabled}
            />

            {/* Description */}
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Optional description..."
              placeholderTextColor={colors.textDisabled}
              multiline
              textAlignVertical="top"
            />

            {/* Poll Type */}
            <Text style={styles.inputLabel}>Type *</Text>
            <View style={styles.typeRow}>
              {POLL_TYPES.map((pt) => (
                <TouchableOpacity
                  key={pt.key}
                  style={[styles.typeChip, pollType === pt.key && styles.typeChipActive]}
                  onPress={() => setPollType(pt.key)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={pt.icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                    color={pollType === pt.key ? '#fff' : colors.textSecondary}
                  />
                  <Text style={[styles.typeChipText, pollType === pt.key && styles.typeChipTextActive]}>
                    {pt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Target Role */}
            <Text style={styles.inputLabel}>Target Audience</Text>
            <View style={styles.typeRow}>
              {(['student', 'all'] as const).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[styles.typeChip, targetRole === role && styles.typeChipActive]}
                  onPress={() => setTargetRole(role)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.typeChipText, targetRole === role && styles.typeChipTextActive]}>
                    {role === 'student' ? 'Students Only' : 'Everyone'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Questions */}
            <View style={styles.questionsHeader}>
              <Text style={styles.inputLabel}>Questions ({questions.length})</Text>
              <TouchableOpacity onPress={addQuestion} style={styles.addBtn} activeOpacity={0.7}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {questions.map((q, qi) => (
              <View key={qi} style={styles.questionDraftCard}>
                <View style={styles.qdHeader}>
                  <Text style={styles.qdNumber}>Q{qi + 1}</Text>
                  <TouchableOpacity onPress={() => removeQuestion(qi)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={styles.input}
                  value={q.questionText}
                  onChangeText={(v) => updateQuestion(qi, 'questionText', v)}
                  placeholder="Question text..."
                  placeholderTextColor={colors.textDisabled}
                />

                {/* Question type selector */}
                <View style={styles.qTypeRow}>
                  {QUESTION_TYPES.map((qt) => (
                    <TouchableOpacity
                      key={qt.key}
                      style={[styles.qTypeChip, q.questionType === qt.key && styles.qTypeChipActive]}
                      onPress={() => updateQuestion(qi, 'questionType', qt.key)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.qTypeText, q.questionType === qt.key && styles.qTypeTextActive]}
                        numberOfLines={1}
                      >
                        {qt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Options (for choice types) */}
                {['single_choice', 'multiple_choice'].includes(q.questionType) && (
                  <View style={styles.optionsDraft}>
                    {q.options.map((opt, oi) => (
                      <View key={oi} style={styles.optionDraftRow}>
                        {pollType === 'quiz' && (
                          <TouchableOpacity
                            onPress={() => updateQuestion(qi, 'correctOptionIndex', oi)}
                            hitSlop={4}
                          >
                            <Ionicons
                              name={q.correctOptionIndex === oi ? 'checkmark-circle' : 'ellipse-outline'}
                              size={20}
                              color={q.correctOptionIndex === oi ? colors.success : colors.textDisabled}
                            />
                          </TouchableOpacity>
                        )}
                        <TextInput
                          style={styles.optionInput}
                          value={opt}
                          onChangeText={(v) => updateOption(qi, oi, v)}
                          placeholder={`Option ${oi + 1}`}
                          placeholderTextColor={colors.textDisabled}
                        />
                        {q.options.length > 2 && (
                          <TouchableOpacity onPress={() => removeOption(qi, oi)} hitSlop={4}>
                            <Ionicons name="close-circle" size={20} color={colors.error} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    <TouchableOpacity
                      style={styles.addOptionBtn}
                      onPress={() => addOption(qi)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={16} color={colors.primary} />
                      <Text style={styles.addOptionText}>Add Option</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {pollType === 'quiz' && ['single_choice', 'multiple_choice'].includes(q.questionType) && (
                  <Text style={styles.correctHint}>
                    {q.correctOptionIndex !== undefined
                      ? `Correct: Option ${q.correctOptionIndex + 1}`
                      : 'Tap the circle to mark the correct answer'}
                  </Text>
                )}
              </View>
            ))}

            {questions.length === 0 && (
              <View style={styles.noQuestionsCard}>
                <Ionicons name="help-circle-outline" size={40} color={colors.textDisabled} />
                <Text style={styles.noQuestionsText}>
                  Add questions to your poll
                </Text>
              </View>
            )}

            {/* Create Button */}
            <TouchableOpacity
              style={[styles.createBtn, creating && { opacity: 0.6 }]}
              onPress={handleCreate}
              disabled={creating}
              activeOpacity={0.7}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={22} color="#fff" />
                  <Text style={styles.createBtnText}>Publish Poll</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={{ height: spacing.xxl }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── LIST VIEW ──
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.listHeader}>
        <Text style={styles.screenTitle}>My Polls</Text>
        <TouchableOpacity
          style={styles.fabBtn}
          onPress={() => setMode('create')}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.fabText}>Create</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={myPolls}
          keyExtractor={(item) => item.id}
          contentContainerStyle={myPolls.length === 0 ? styles.emptyList : styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          renderItem={({ item }) => (
            <View style={styles.pollCard}>
              <TouchableOpacity
                style={styles.pollCardMain}
                onPress={() => handleViewResults(item)}
                activeOpacity={0.7}
              >
                <View style={styles.pollCardInfo}>
                  <Text style={styles.pollCardTitle} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.pollCardMeta}>
                    <View style={[styles.typeBadge, { backgroundColor: (item.isActive ? colors.success : colors.textDisabled) + '15' }]}>
                      <Text style={[styles.typeBadgeText, { color: item.isActive ? colors.success : colors.textDisabled }]}>
                        {item.isActive ? 'Active' : 'Closed'}
                      </Text>
                    </View>
                    <Text style={styles.metaText}>{item.pollType}</Text>
                    <Text style={styles.metaText}>{item.responseCount || 0} responses</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
              </TouchableOpacity>
              {item.isActive && (
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={() => handleClosePoll(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="clipboard-outline" size={64} color={colors.textDisabled} />
              <Text style={styles.emptyTitle}>No Polls Yet</Text>
              <Text style={styles.emptyText}>
                Create your first poll or quiz for students.
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modeHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  fabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  fabText: {
    fontSize: 14,
    fontWeight: '600',
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
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  pollCardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  pollCardInfo: {
    flex: 1,
  },
  pollCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  pollCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
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
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  closeBtnText: {
    fontSize: 13,
    color: colors.error,
    fontWeight: '500',
  },

  // Create form
  createContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textArea: {
    minHeight: 60,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  typeChipTextActive: {
    color: '#fff',
  },

  // Questions
  questionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  questionDraftCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qdHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  qdNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  qTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  qTypeChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qTypeChipActive: {
    backgroundColor: colors.info + '15',
    borderColor: colors.info,
  },
  qTypeText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  qTypeTextActive: {
    color: colors.info,
    fontWeight: '600',
  },

  // Options
  optionsDraft: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  optionDraftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  optionInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    fontSize: 13,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  addOptionText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  correctHint: {
    fontSize: 11,
    color: colors.success,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  noQuestionsCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  noQuestionsText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  // Create button
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.success,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  // Results
  resultsContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  resultsSummary: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  resultsPollTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  resultsStats: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
  resultsStat: {
    alignItems: 'center',
  },
  resultsStatValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
  },
  resultsStatLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  questionResultCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  qrNumber: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 4,
  },
  qrText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  qrOptions: {
    gap: spacing.xs,
  },
  qrOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  qrBarBg: {
    flex: 1,
    height: 20,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  qrBarFill: {
    height: '100%',
    backgroundColor: colors.primary + '40',
    borderRadius: borderRadius.sm,
  },
  qrOptionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    minWidth: 60,
  },
  qrRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  qrRatingText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  qrTextAnswers: {
    gap: spacing.xs,
  },
  qrTextAnswer: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  qrMoreText: {
    fontSize: 12,
    color: colors.textDisabled,
    marginTop: 4,
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
