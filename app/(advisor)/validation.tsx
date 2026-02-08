import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { logService } from '@/services/logs';
import { notificationService } from '@/services/notifications';
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
  photos: { id: string; uri: string; caption?: string }[];
  selfAssessment?: {
    competencyRatings: Record<string, number>;
    reflectionNotes: string;
  };
  mentorFeedback?: {
    rating: number;
    comments: string;
    competencyRatings: Record<string, number>;
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
              await advisorService.validateLog(selectedLog.id);

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
    return (
      <SafeAreaView style={styles.safeArea}>
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
                  {new Date(selectedLog.date).toLocaleDateString('en-US', {
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
              <Text style={styles.cardTitle}>{selectedLog.title}</Text>
              <Text style={styles.cardContent}>{selectedLog.content}</Text>

              {selectedLog.activitiesPerformed ? (
                <View style={styles.logSection}>
                  <Text style={styles.logSectionLabel}>Activities Performed</Text>
                  <Text style={styles.logSectionText}>{selectedLog.activitiesPerformed}</Text>
                </View>
              ) : null}

              {selectedLog.skillsLearned ? (
                <View style={styles.logSection}>
                  <Text style={styles.logSectionLabel}>Skills Learned</Text>
                  <Text style={styles.logSectionText}>{selectedLog.skillsLearned}</Text>
                </View>
              ) : null}

              {selectedLog.challengesFaced ? (
                <View style={styles.logSection}>
                  <Text style={styles.logSectionLabel}>Challenges Faced</Text>
                  <Text style={styles.logSectionText}>{selectedLog.challengesFaced}</Text>
                </View>
              ) : null}
            </View>

            {/* Photos */}
            {logDetail && logDetail.photos.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Photos ({logDetail.photos.length})</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosScroll}>
                  {logDetail.photos.map((photo) => (
                    <View key={photo.id} style={styles.photoWrapper}>
                      <Image source={{ uri: photo.uri }} style={styles.photo} />
                      {photo.caption ? (
                        <Text style={styles.photoCaption} numberOfLines={1}>{photo.caption}</Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

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
                  return (
                    <View key={compKey} style={styles.compRow}>
                      <Text style={styles.compLabel}>{getCompetencyLabel(compKey)}</Text>
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

            {/* Validate Button */}
            <TouchableOpacity
              style={styles.validateBtn}
              onPress={handleValidate}
              disabled={submitting}
              activeOpacity={0.7}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="shield-checkmark" size={22} color="#fff" />
                  <Text style={styles.validateBtnText}>Validate Log</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={{ height: spacing.xxl }} />
          </ScrollView>
        )}
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

  // Validate button
  validateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.status.validated,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  validateBtnText: {
    fontSize: 17,
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
