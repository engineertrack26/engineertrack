import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { logService } from '@/services/logs';
import { notificationService } from '@/services/notifications';
import { COMPETENCY_RUBRIC } from '@/utils/constants';
import { colors, spacing, borderRadius } from '@/theme';

const COMPETENCY_LABELS: Record<string, string> = {
  technical_skills: 'Technical Skills',
  problem_solving: 'Problem Solving',
  communication: 'Communication',
  teamwork: 'Teamwork',
  time_management: 'Time Management',
  adaptability: 'Adaptability',
  initiative: 'Initiative',
  professional_ethics: 'Professional Ethics',
};

interface PendingLogItem {
  id: string;
  studentId: string;
  title: string;
  date: string;
  content: string;
  activitiesPerformed: string;
  skillsLearned: string;
  challengesFaced: string;
  hoursSpent: number;
  createdAt: string;
  studentFirstName: string;
  studentLastName: string;
  mentorRating: number;
  mentorComments: string;
  mentorCompetencyRatings: Record<string, number>;
}

interface LogDetail {
  id: string;
  studentId: string;
  title: string;
  date: string;
  content: string;
  activitiesPerformed: string;
  skillsLearned: string;
  challengesFaced: string;
  hoursSpent: number;
  photos: { id: string; uri: string; caption?: string }[];
  selfAssessment?: {
    competencyRatings: Record<string, number>;
    reflectionNotes: string;
  };
  mentorFeedback?: {
    rating: number;
    comments: string;
    competencyRatings: Record<string, number>;
    areasOfExcellence?: string;
  };
}

function mapPendingLog(row: Record<string, unknown>): PendingLogItem {
  const profile = row.profiles as Record<string, unknown> | null;
  const feedbacks = Array.isArray(row.mentor_feedbacks) ? row.mentor_feedbacks : [];
  const fb = feedbacks[0] as Record<string, unknown> | undefined;
  return {
    id: row.id as string,
    studentId: (row.student_id as string) || '',
    title: (row.title as string) || '',
    date: row.date as string,
    content: (row.content as string) || '',
    activitiesPerformed: (row.activities_performed as string) || '',
    skillsLearned: (row.skills_learned as string) || '',
    challengesFaced: (row.challenges_faced as string) || '',
    hoursSpent: (row.hours_spent as number) || 0,
    createdAt: (row.created_at as string) || '',
    studentFirstName: (profile?.first_name as string) || '',
    studentLastName: (profile?.last_name as string) || '',
    mentorRating: (fb?.rating as number) || 0,
    mentorComments: (fb?.comments as string) || '',
    mentorCompetencyRatings: (fb?.competency_ratings as Record<string, number>) || {},
  };
}

function mapLogDetail(row: Record<string, unknown>): LogDetail {
  const photos = Array.isArray(row.log_photos) ? row.log_photos : [];
  const selfAssessments = Array.isArray(row.self_assessments) ? row.self_assessments : [];
  const sa = selfAssessments[0] as Record<string, unknown> | undefined;
  const feedbacks = Array.isArray(row.mentor_feedbacks) ? row.mentor_feedbacks : [];
  const fb = feedbacks[0] as Record<string, unknown> | undefined;

  return {
    id: row.id as string,
    studentId: (row.student_id as string) || '',
    title: (row.title as string) || '',
    date: row.date as string,
    content: (row.content as string) || '',
    activitiesPerformed: (row.activities_performed as string) || '',
    skillsLearned: (row.skills_learned as string) || '',
    challengesFaced: (row.challenges_faced as string) || '',
    hoursSpent: (row.hours_spent as number) || 0,
    photos: photos.map((p: Record<string, unknown>) => ({
      id: (p.id as string) || '',
      uri: (p.uri as string) || '',
      caption: (p.caption as string) || undefined,
    })),
    selfAssessment: sa
      ? {
          competencyRatings: (sa.competency_ratings as Record<string, number>) || {},
          reflectionNotes: (sa.reflection_notes as string) || '',
        }
      : undefined,
    mentorFeedback: fb
      ? {
          rating: (fb.rating as number) || 0,
          comments: (fb.comments as string) || '',
          competencyRatings: (fb.competency_ratings as Record<string, number>) || {},
          areasOfExcellence: (fb.areas_of_excellence as string) || undefined,
        }
      : undefined,
  };
}

function StarDisplay({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={star <= value ? 'star' : 'star-outline'}
          size={size}
          color={star <= value ? colors.gamification.gold : colors.textDisabled}
        />
      ))}
    </View>
  );
}

export default function ValidationScreen() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingLogs, setPendingLogs] = useState<PendingLogItem[]>([]);

  // Detail view state
  const [selectedLog, setSelectedLog] = useState<PendingLogItem | null>(null);
  const [logDetail, setLogDetail] = useState<LogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [advisorNotes, setAdvisorNotes] = useState('');
  const [expandedRubric, setExpandedRubric] = useState<string | null>(null);

  const loadPendingLogs = useCallback(async () => {
    if (!user) return;
    try {
      const data = await advisorService.getPendingValidationLogs(user.id);
      setPendingLogs(
        (data || []).map((l) => mapPendingLog(l as unknown as Record<string, unknown>)),
      );
    } catch (err) {
      console.error('Load pending validation logs error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadPendingLogs();
    }, [loadPendingLogs]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPendingLogs();
    setRefreshing(false);
  }, [loadPendingLogs]);

  const handleSelectLog = useCallback(async (log: PendingLogItem) => {
    setSelectedLog(log);
    setLoadingDetail(true);
    try {
      const detail = await logService.getLogWithDetails(log.id);
      setLogDetail(mapLogDetail(detail as unknown as Record<string, unknown>));
    } catch (err) {
      console.error('Load log detail error:', err);
      Alert.alert('Error', 'Failed to load log details.');
      setSelectedLog(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleBack = () => {
    setSelectedLog(null);
    setLogDetail(null);
  };

  const handleValidate = () => {
    if (!user || !selectedLog) return;

    Alert.alert(
      'Validate Log',
      `Are you sure you want to validate this log by ${selectedLog.studentFirstName} ${selectedLog.studentLastName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Validate',
          onPress: async () => {
            setSubmitting(true);
            try {
              await advisorService.validateLog(selectedLog.id, advisorNotes.trim() || undefined);

              // Send notification to student
              const advisorName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Your advisor';
              try {
                await notificationService.create(
                  selectedLog.studentId,
                  'Log Validated!',
                  `${advisorName} validated your log "${selectedLog.title}". Final approval complete!`,
                  'log_approved',
                  { logId: selectedLog.id },
                );
              } catch (notifErr) {
                console.warn('Notification insert failed (RLS?):', notifErr);
              }

              Alert.alert('Success', 'Log validated successfully!');
              setSelectedLog(null);
              setLogDetail(null);
              setAdvisorNotes('');
              loadPendingLogs();
            } catch (err) {
              console.error('Validate log error:', err);
              Alert.alert('Error', 'Failed to validate log. Please try again.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const handleSendBack = () => {
    if (!user || !selectedLog) return;
    if (!advisorNotes.trim()) {
      Alert.alert('Notes Required', 'Please add notes explaining why the log is being sent back.');
      return;
    }

    Alert.alert(
      'Send Back to Mentor',
      'This log will be sent back to the mentor for further review. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Back',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              await advisorService.sendBackToMentor(selectedLog.id, advisorNotes.trim());

              // Send notification to student
              const advisorName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Your advisor';
              try {
                await notificationService.create(
                  selectedLog.studentId,
                  'Log Sent Back',
                  `${advisorName} sent back your log "${selectedLog.title}" for mentor re-review.`,
                  'log_sent_back',
                  { logId: selectedLog.id },
                );
              } catch (notifErr) {
                console.warn('Notification insert failed (RLS?):', notifErr);
              }

              Alert.alert('Done', 'Log sent back to mentor for re-review.');
              setSelectedLog(null);
              setLogDetail(null);
              setAdvisorNotes('');
              loadPendingLogs();
            } catch (err) {
              console.error('Send back error:', err);
              Alert.alert('Error', 'Failed to send back log. Please try again.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

  const getWaitTime = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const getCompetencyLabel = (key: string) =>
    COMPETENCY_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // ─── DETAIL VIEW ───
  if (selectedLog) {
    const logData = logDetail || {
      id: selectedLog.id,
      studentId: selectedLog.studentId,
      title: selectedLog.title,
      date: selectedLog.date,
      content: selectedLog.content,
      activitiesPerformed: selectedLog.activitiesPerformed,
      skillsLearned: selectedLog.skillsLearned,
      challengesFaced: selectedLog.challengesFaced,
      hoursSpent: selectedLog.hoursSpent,
      photos: [],
      selfAssessment: undefined,
      mentorFeedback: undefined,
    };

    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        {/* Header */}
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.detailHeaderTitle} numberOfLines={1}>
            Validate Log
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {loadingDetail ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.detailContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Student Info */}
            <View style={styles.studentInfoCard}>
              <View style={styles.studentAvatar}>
                <Text style={styles.studentInitials}>
                  {getInitials(selectedLog.studentFirstName, selectedLog.studentLastName)}
                </Text>
              </View>
              <View>
                <Text style={styles.studentNameDetail}>
                  {selectedLog.studentFirstName} {selectedLog.studentLastName}
                </Text>
                <Text style={styles.logDateDetail}>
                  {new Date(logData.date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              </View>
            </View>

            {/* Log Content */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{logData.title || '-'}</Text>
              <Text style={styles.cardContent}>{logData.content || '-'}</Text>

              <View style={styles.logSection}>
                <Text style={styles.logSectionLabel}>Activities Performed</Text>
                <Text style={styles.logSectionText}>{logData.activitiesPerformed || '-'}</Text>
              </View>

              <View style={styles.logSection}>
                <Text style={styles.logSectionLabel}>Skills Learned</Text>
                <Text style={styles.logSectionText}>{logData.skillsLearned || '-'}</Text>
              </View>

              <View style={styles.logSection}>
                <Text style={styles.logSectionLabel}>Challenges Faced</Text>
                <Text style={styles.logSectionText}>{logData.challengesFaced || '-'}</Text>
              </View>

              <View style={styles.logSection}>
                <Text style={styles.logSectionLabel}>Time Spent</Text>
                <View style={styles.timeSpentDisplay}>
                  <Ionicons name="time-outline" size={16} color={colors.primary} />
                  <Text style={styles.timeSpentText}>
                    {logData.hoursSpent > 0
                      ? `${Math.floor(logData.hoursSpent / 60)}h ${logData.hoursSpent % 60}m`
                      : '-'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Photos */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Photos ({logData.photos.length})</Text>
              {logData.photos.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosScroll}>
                  {logData.photos.map((photo) => (
                    <View key={photo.id} style={styles.photoWrapper}>
                      <Image source={{ uri: photo.uri }} style={styles.photo} />
                      {photo.caption ? (
                        <Text style={styles.photoCaption} numberOfLines={1}>{photo.caption}</Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.logSectionText}>-</Text>
              )}
            </View>

            {/* Self Assessment */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Self Assessment</Text>
              {logDetail?.selfAssessment?.competencyRatings &&
              Object.keys(logDetail.selfAssessment.competencyRatings).length > 0 ? (
                Object.entries(logDetail.selfAssessment.competencyRatings).map(([compKey, score]) => (
                  <View key={compKey} style={styles.compRow}>
                    <Text style={styles.compLabel}>{getCompetencyLabel(compKey)}</Text>
                    <View style={[styles.scoreBadge, styles.selfBadge]}>
                      <Text style={styles.selfBadgeText}>{score || '-'}/5</Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.logSectionText}>-</Text>
              )}
            </View>

            {/* Mentor Feedback */}
            {logDetail?.mentorFeedback && (
              <View style={[styles.card, styles.mentorFeedbackCard]}>
                <Text style={styles.mentorFeedbackTitle}>Mentor Feedback</Text>

                {/* Overall Rating */}
                <View style={styles.feedbackRow}>
                  <Text style={styles.feedbackLabel}>Overall Rating</Text>
                  <StarDisplay value={logDetail.mentorFeedback.rating} size={20} />
                </View>

                {/* Comments */}
                {logDetail.mentorFeedback.comments ? (
                  <View style={styles.feedbackCommentBox}>
                    <Text style={styles.feedbackCommentLabel}>Comments</Text>
                    <Text style={styles.feedbackCommentText}>{logDetail.mentorFeedback.comments}</Text>
                  </View>
                ) : null}

                {/* Areas of Excellence from Mentor */}
                {logDetail.mentorFeedback.areasOfExcellence ? (
                  <View style={styles.excellenceBox}>
                    <View style={styles.excellenceHeader}>
                      <Ionicons name="trophy" size={16} color={colors.success} />
                      <Text style={styles.excellenceLabel}>Areas of Excellence</Text>
                    </View>
                    <Text style={styles.excellenceText}>
                      {logDetail.mentorFeedback.areasOfExcellence}
                    </Text>
                  </View>
                ) : null}

                {/* Competency Ratings Comparison */}
                <Text style={styles.comparisonTitle}>Competency Assessment</Text>
                <View style={styles.comparisonHeader}>
                  <Text style={styles.compHeaderLabel}>Competency</Text>
                  <View style={styles.compHeaderRight}>
                    <Text style={styles.compHeaderBadgeSelf}>Self</Text>
                    <Text style={styles.compHeaderBadgeMentor}>Mentor</Text>
                  </View>
                </View>

                {Object.keys(logDetail.mentorFeedback.competencyRatings).map((compKey) => {
                  const mentorScore = logDetail.mentorFeedback!.competencyRatings[compKey] || 0;
                  const selfScore = logDetail.selfAssessment?.competencyRatings[compKey] || 0;
                  const diff = Math.abs(selfScore - mentorScore);
                  const rubric = COMPETENCY_RUBRIC[compKey];
                  const isExpanded = expandedRubric === compKey;
                  return (
                    <View key={compKey}>
                      <View style={styles.compRow}>
                        <View style={styles.compLabelRow}>
                          <Text style={styles.compLabel}>{getCompetencyLabel(compKey)}</Text>
                          {rubric && (
                            <TouchableOpacity
                              onPress={() => setExpandedRubric(isExpanded ? null : compKey)}
                              hitSlop={8}
                            >
                              <Ionicons
                                name={isExpanded ? 'information-circle' : 'information-circle-outline'}
                                size={18}
                                color={isExpanded ? colors.primary : colors.textDisabled}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.compScores}>
                          <View style={[styles.scoreBadge, styles.selfBadge]}>
                            <Text style={styles.selfBadgeText}>{selfScore || '-'}/5</Text>
                          </View>
                          <View style={[styles.scoreBadge, styles.mentorBadge]}>
                            <Text style={styles.mentorBadgeText}>{mentorScore}/5</Text>
                          </View>
                          {diff > 1.5 && (
                            <Ionicons name="warning" size={14} color={colors.warning} />
                          )}
                        </View>
                      </View>
                      {isExpanded && rubric && (
                        <View style={styles.rubricPanel}>
                          <Text style={styles.rubricDesc}>{rubric.description}</Text>
                          {rubric.levels.map((level, idx) => {
                            const levelNum = idx + 1;
                            const isSelfLevel = selfScore === levelNum;
                            const isMentorLevel = mentorScore === levelNum;
                            return (
                              <View
                                key={idx}
                                style={[
                                  styles.rubricLevel,
                                  (isSelfLevel || isMentorLevel) && styles.rubricLevelHighlight,
                                ]}
                              >
                                <Text style={[
                                  styles.rubricLevelText,
                                  (isSelfLevel || isMentorLevel) && styles.rubricLevelTextHighlight,
                                ]}>
                                  {level}
                                </Text>
                                <View style={styles.rubricTags}>
                                  {isSelfLevel && (
                                    <View style={[styles.rubricTag, { backgroundColor: colors.info + '20' }]}>
                                      <Text style={[styles.rubricTagText, { color: colors.info }]}>Self</Text>
                                    </View>
                                  )}
                                  {isMentorLevel && (
                                    <View style={[styles.rubricTag, { backgroundColor: colors.secondary + '20' }]}>
                                      <Text style={[styles.rubricTagText, { color: colors.secondary }]}>Mentor</Text>
                                    </View>
                                  )}
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Student Self-Reflection */}
            {logDetail?.selfAssessment?.reflectionNotes ? (
              <View style={styles.reflectionBox}>
                <Text style={styles.reflectionLabel}>Student's Self-Reflection</Text>
                <Text style={styles.reflectionText}>
                  {logDetail.selfAssessment.reflectionNotes}
                </Text>
              </View>
            ) : null}

            {/* Advisor Notes */}
            <View style={styles.card}>
              <Text style={styles.advisorNotesTitle}>Advisor Notes</Text>
              <TextInput
                style={styles.advisorNotesInput}
                value={advisorNotes}
                onChangeText={setAdvisorNotes}
                placeholder="Add your notes or comments (required for Send Back)..."
                placeholderTextColor={colors.textDisabled}
                multiline
                textAlignVertical="top"
              />
            </View>

            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.sendBackBtn]}
                onPress={handleSendBack}
                disabled={submitting}
                activeOpacity={0.7}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.warning} />
                ) : (
                  <>
                    <Ionicons name="arrow-undo" size={20} color={colors.warning} />
                    <Text style={styles.sendBackBtnText}>Send Back</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.validateBtn]}
                onPress={handleValidate}
                disabled={submitting}
                activeOpacity={0.7}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="shield-checkmark" size={20} color="#fff" />
                    <Text style={styles.validateBtnText}>Validate</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={{ height: spacing.xxl }} />
          </ScrollView>
        )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ─── LIST VIEW ───
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerContainer}>
        <Text style={styles.screenTitle}>Validate Logs</Text>
        <Text style={styles.countText}>
          {pendingLogs.length} pending
        </Text>
      </View>

      <FlatList
        data={pendingLogs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.logCard}
            onPress={() => handleSelectLog(item)}
            activeOpacity={0.7}
          >
            <View style={styles.logCardTop}>
              <View style={styles.logCardAvatar}>
                <Text style={styles.logCardInitials}>
                  {getInitials(item.studentFirstName, item.studentLastName)}
                </Text>
              </View>
              <View style={styles.logCardInfo}>
                <Text style={styles.logCardStudent} numberOfLines={1}>
                  {item.studentFirstName} {item.studentLastName}
                </Text>
                <Text style={styles.logCardTitle} numberOfLines={1}>{item.title}</Text>
              </View>
              <View style={styles.logCardRight}>
                <Text style={styles.logCardWait}>{getWaitTime(item.createdAt)}</Text>
                <Text style={styles.logCardDate}>
                  {new Date(item.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            </View>
            <Text style={styles.logCardContent} numberOfLines={2}>{item.content}</Text>
            <View style={styles.logCardFooter}>
              <View style={styles.statusBadge}>
                <Ionicons name="checkmark-circle-outline" size={12} color={colors.status.approved} />
                <Text style={styles.statusBadgeText}>Mentor Approved</Text>
              </View>
              {item.mentorRating > 0 && (
                <View style={styles.ratingBadge}>
                  <Ionicons name="star" size={12} color={colors.gamification.gold} />
                  <Text style={styles.ratingBadgeText}>{item.mentorRating}/5</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="shield-checkmark" size={64} color={colors.success} />
            <Text style={styles.emptyTitle}>All Validated!</Text>
            <Text style={styles.emptyText}>
              No pending logs to validate. Great job!
            </Text>
          </View>
        }
      />
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
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  countText: {
    fontSize: 14,
    color: colors.warning,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },

  // Log Cards (list view)
  logCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  logCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logCardAvatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.status.approved + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  logCardInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.status.approved,
  },
  logCardInfo: {
    flex: 1,
  },
  logCardStudent: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  logCardTitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  logCardRight: {
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  logCardWait: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: '600',
  },
  logCardDate: {
    fontSize: 11,
    color: colors.textDisabled,
    marginTop: 2,
  },
  logCardContent: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  logCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.status.approved + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.status.approved,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.gamification.gold + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    marginLeft: 'auto',
  },
  ratingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gamification.gold,
  },

  // Detail View
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  detailHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  detailContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

  // Student info
  studentInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
  studentAvatar: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  studentInitials: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.primary,
  },
  studentNameDetail: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  logDateDetail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Card
  card: {
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  cardContent: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  // Log sections
  logSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  logSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  logSectionText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  // Photos
  photosScroll: {
    marginTop: spacing.xs,
  },
  photoWrapper: {
    marginRight: spacing.sm,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.border,
  },
  photoCaption: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
    width: 120,
  },

  // Mentor Feedback Card
  mentorFeedbackCard: {
    borderWidth: 2,
    borderColor: colors.secondary + '30',
  },
  mentorFeedbackTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.secondary,
    marginBottom: spacing.md,
  },
  feedbackRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  feedbackLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  feedbackCommentBox: {
    backgroundColor: colors.secondary + '08',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.secondary,
  },
  feedbackCommentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  feedbackCommentText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Comparison
  comparisonTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.secondary + '30',
    marginBottom: spacing.xs,
  },
  compHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  compHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  compHeaderBadgeSelf: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.info,
    textTransform: 'uppercase',
  },
  compHeaderBadgeMentor: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
    textTransform: 'uppercase',
  },
  compRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  compLabel: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
    flex: 1,
  },
  compScores: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scoreBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    minWidth: 40,
    alignItems: 'center',
  },
  selfBadge: {
    backgroundColor: colors.info + '12',
  },
  selfBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.info,
  },
  mentorBadge: {
    backgroundColor: colors.secondary + '12',
  },
  mentorBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
  },

  // Reflection
  reflectionBox: {
    backgroundColor: colors.info + '08',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
  },
  reflectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.info,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  reflectionText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Time Spent Display
  timeSpentDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  timeSpentText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },

  // Areas of Excellence Box
  excellenceBox: {
    backgroundColor: colors.success + '08',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  excellenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  excellenceLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
    textTransform: 'uppercase',
  },
  excellenceText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Rubric
  compLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  rubricPanel: {
    backgroundColor: colors.primary + '06',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary + '40',
  },
  rubricDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  rubricLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.sm,
    marginBottom: 2,
  },
  rubricLevelHighlight: {
    backgroundColor: colors.primary + '12',
  },
  rubricLevelText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  rubricLevelTextHighlight: {
    color: colors.text,
    fontWeight: '600',
  },
  rubricTags: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: spacing.xs,
  },
  rubricTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  rubricTagText: {
    fontSize: 10,
    fontWeight: '700',
  },

  // Advisor Notes
  advisorNotesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  advisorNotesInput: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.text,
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Action Buttons
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 4,
    borderRadius: borderRadius.md,
  },
  sendBackBtn: {
    borderWidth: 1.5,
    borderColor: colors.warning,
    backgroundColor: 'transparent',
  },
  sendBackBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.warning,
  },
  validateBtn: {
    backgroundColor: colors.success,
  },
  validateBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl * 2,
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
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
