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
import { mentorService } from '@/services/mentor';
import { logService } from '@/services/logs';
import { gamificationService } from '@/services/gamification';
import { notificationService } from '@/services/notifications';
import { COMPETENCIES, LIMITS } from '@/utils/constants';
import { colors, spacing, borderRadius } from '@/theme';

const REVISION_CHECKLIST = [
  { key: 'description', label: 'Description needs more detail', icon: 'document-text-outline' as const },
  { key: 'photos', label: 'Photos insufficient or missing', icon: 'camera-outline' as const },
  { key: 'reflection', label: 'Self-reflection too brief', icon: 'chatbubble-ellipses-outline' as const },
  { key: 'time', label: 'Time logging inaccurate', icon: 'time-outline' as const },
  { key: 'competencies', label: "Competencies don't match activities", icon: 'stats-chart-outline' as const },
  { key: 'activities', label: 'Activities not clearly described', icon: 'list-outline' as const },
  { key: 'skills', label: 'Skills learned section incomplete', icon: 'school-outline' as const },
];

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
  studentAvatarUrl?: string;
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
}

function mapPendingLog(row: Record<string, unknown>): PendingLogItem {
  const profile = row.profiles as Record<string, unknown> | null;
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
    studentAvatarUrl: (profile?.avatar_url as string) || undefined,
  };
}

function mapLogDetail(row: Record<string, unknown>): LogDetail {
  const photos = Array.isArray(row.log_photos) ? row.log_photos : [];
  const selfAssessments = Array.isArray(row.self_assessments) ? row.self_assessments : [];
  const sa = selfAssessments[0] as Record<string, unknown> | undefined;

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
  };
}

function StarRating({
  value,
  onChange,
  size = 24,
  readonly = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  readonly?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star}
          onPress={() => !readonly && onChange?.(star)}
          disabled={readonly}
          activeOpacity={readonly ? 1 : 0.6}
          hitSlop={4}
        >
          <Ionicons
            name={star <= value ? 'star' : 'star-outline'}
            size={size}
            color={star <= value ? colors.gamification.gold : colors.textDisabled}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function ReviewLogScreen() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingLogs, setPendingLogs] = useState<PendingLogItem[]>([]);

  // Detail view state
  const [selectedLog, setSelectedLog] = useState<PendingLogItem | null>(null);
  const [logDetail, setLogDetail] = useState<LogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Review form state
  const [competencyRatings, setCompetencyRatings] = useState<Record<string, number>>({});
  const [overallRating, setOverallRating] = useState(0);
  const [comments, setComments] = useState('');
  const [revisionChecks, setRevisionChecks] = useState<Set<string>>(new Set());
  const [revisionNotes, setRevisionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadPendingLogs = useCallback(async () => {
    if (!user) return;
    try {
      const data = await mentorService.getPendingReviewLogs(user.id);
      setPendingLogs(
        (data || []).map((l) => mapPendingLog(l as unknown as Record<string, unknown>)),
      );
    } catch (err) {
      console.error('Load pending logs error:', err);
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
    // Reset form
    setCompetencyRatings({});
    setOverallRating(0);
    setComments('');
    setRevisionChecks(new Set());
    setRevisionNotes('');
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

  const validateForm = (): string | null => {
    const ratedCount = Object.values(competencyRatings).filter((v) => v > 0).length;
    if (ratedCount < COMPETENCIES.length) {
      return 'Please rate all competencies.';
    }
    if (overallRating === 0) {
      return 'Please provide an overall rating.';
    }
    if (!comments.trim()) {
      return 'Please add a comment.';
    }
    return null;
  };

  const handleSubmitReview = async (isApproved: boolean) => {
    if (!user || !selectedLog) return;

    if (!isApproved && revisionChecks.size === 0) {
      Alert.alert('Required', 'Please select at least one revision item.');
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      Alert.alert('Incomplete', validationError);
      return;
    }

    const action = isApproved ? 'approve' : 'request revision for';
    Alert.alert(
      isApproved ? 'Approve Log' : 'Request Revision',
      `Are you sure you want to ${action} this log?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isApproved ? 'Approve' : 'Request Revision',
          style: isApproved ? 'default' : 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              // Build structured revision notes from checklist + freeform
              let combinedRevisionNotes: string | undefined;
              if (!isApproved) {
                const checkedLabels = REVISION_CHECKLIST
                  .filter((item) => revisionChecks.has(item.key))
                  .map((item) => `- ${item.label}`);
                const parts: string[] = [];
                if (checkedLabels.length > 0) {
                  parts.push('Items to revise:\n' + checkedLabels.join('\n'));
                }
                if (revisionNotes.trim()) {
                  parts.push('Additional notes:\n' + revisionNotes.trim());
                }
                combinedRevisionNotes = parts.join('\n\n');
              }

              await logService.submitFeedback(
                selectedLog.id,
                user.id,
                overallRating,
                comments.trim(),
                competencyRatings,
                isApproved,
                combinedRevisionNotes,
              );

              if (isApproved) {
                try {
                  await gamificationService.processLogApproval(
                    selectedLog.studentId,
                    selectedLog.id,
                  );
                } catch (xpErr) {
                  console.warn('XP processing failed (RLS?):', xpErr);
                }
              }

              // Send notification to student
              const mentorName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Your mentor';
              try {
                await notificationService.create(
                  selectedLog.studentId,
                  isApproved ? 'Log Approved!' : 'Revision Requested',
                  isApproved
                    ? `${mentorName} approved your log "${selectedLog.title}". You earned XP!`
                    : `${mentorName} requested revisions on your log "${selectedLog.title}".`,
                  isApproved ? 'log_approved' : 'log_revision_requested',
                  { logId: selectedLog.id },
                );
              } catch (notifErr) {
                console.warn('Notification insert failed (RLS?):', notifErr);
              }

              Alert.alert(
                'Success',
                isApproved
                  ? 'Log approved successfully! Student earned XP.'
                  : 'Revision requested. Student will be notified.',
              );
              setSelectedLog(null);
              setLogDetail(null);
              loadPendingLogs();
            } catch (err) {
              console.error('Submit review error:', err);
              Alert.alert('Error', 'Failed to submit review. Please try again.');
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
              Review Log
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

              {/* Competency Comparison — Side-by-Side */}
              <View style={[styles.card, styles.reviewFormCard]}>
                <Text style={styles.reviewFormTitle}>Competency Assessment</Text>

                {/* Column Headers */}
                <View style={styles.comparisonHeader}>
                  <Text style={styles.compHeaderLabel}>Competency</Text>
                  <View style={styles.compHeaderRight}>
                    <Text style={styles.compHeaderBadge}>Student</Text>
                    <Text style={styles.compHeaderStars}>Your Rating</Text>
                  </View>
                </View>

                {/* Each competency: label row + rating row below */}
                {COMPETENCIES.map((compKey) => {
                  const studentScore = logDetail?.selfAssessment?.competencyRatings[compKey] || 0;
                  return (
                    <View key={compKey} style={styles.comparisonRow}>
                      <Text style={styles.compLabel}>{getCompetencyLabel(compKey)}</Text>
                      <View style={styles.compRatingsRow}>
                        <View style={styles.compScoreCol}>
                          {studentScore > 0 ? (
                            <View style={styles.scoreBadge}>
                              <Ionicons name="person" size={10} color={colors.info} />
                              <Text style={styles.scoreBadgeText}>{studentScore}/5</Text>
                            </View>
                          ) : (
                            <Text style={styles.compNoScore}>-</Text>
                          )}
                        </View>
                        <View style={styles.compMentorCol}>
                          <StarRating
                            value={competencyRatings[compKey] || 0}
                            onChange={(v) =>
                              setCompetencyRatings((prev) => ({ ...prev, [compKey]: v }))
                            }
                            size={18}
                          />
                        </View>
                      </View>
                    </View>
                  );
                })}

                {/* Student Reflection */}
                {logDetail?.selfAssessment?.reflectionNotes ? (
                  <View style={styles.reflectionBox}>
                    <Text style={styles.reflectionLabel}>Student's Self-Reflection</Text>
                    <Text style={styles.reflectionText}>
                      {logDetail.selfAssessment.reflectionNotes}
                    </Text>
                  </View>
                ) : null}

                {/* Overall Rating */}
                <View style={[styles.ratingRow, styles.overallRatingRow]}>
                  <Text style={styles.overallLabel}>Overall Rating</Text>
                  <StarRating
                    value={overallRating}
                    onChange={setOverallRating}
                    size={30}
                  />
                </View>

                {/* Comments */}
                <Text style={styles.inputLabel}>Comments</Text>
                <TextInput
                  style={styles.textArea}
                  value={comments}
                  onChangeText={setComments}
                  placeholder="Write your feedback..."
                  placeholderTextColor={colors.textDisabled}
                  multiline
                  textAlignVertical="top"
                />

                {/* Revision Checklist */}
                <View style={styles.revisionSection}>
                  <Text style={styles.revisionSectionTitle}>Revision Items</Text>
                  <Text style={styles.revisionSectionHint}>Select issues if requesting revision</Text>

                  {REVISION_CHECKLIST.map((item) => {
                    const isChecked = revisionChecks.has(item.key);
                    return (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.checkItem, isChecked && styles.checkItemActive]}
                        onPress={() => {
                          setRevisionChecks((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.key)) {
                              next.delete(item.key);
                            } else {
                              next.add(item.key);
                            }
                            return next;
                          });
                        }}
                        activeOpacity={0.6}
                      >
                        <Ionicons
                          name={isChecked ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={isChecked ? colors.error : colors.textDisabled}
                        />
                        <Ionicons
                          name={item.icon}
                          size={18}
                          color={isChecked ? colors.error : colors.textSecondary}
                        />
                        <Text style={[styles.checkLabel, isChecked && styles.checkLabelActive]}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {/* Additional notes (optional freeform) */}
                  {revisionChecks.size > 0 && (
                    <View style={styles.additionalNotesWrap}>
                      <Text style={styles.inputLabel}>Additional Notes (optional)</Text>
                      <TextInput
                        style={[styles.textArea, styles.revisionInput]}
                        value={revisionNotes}
                        onChangeText={setRevisionNotes}
                        placeholder="Any extra details for the student..."
                        placeholderTextColor={colors.textDisabled}
                        multiline
                        textAlignVertical="top"
                      />
                    </View>
                  )}
                </View>

                {/* Action Buttons */}
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    onPress={() => handleSubmitReview(false)}
                    disabled={submitting}
                    activeOpacity={0.7}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <>
                        <Ionicons name="refresh-outline" size={20} color={colors.error} />
                        <Text style={styles.rejectBtnText}>Request Revision</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    onPress={() => handleSubmitReview(true)}
                    disabled={submitting}
                    activeOpacity={0.7}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={20} color="#fff" />
                        <Text style={styles.approveBtnText}>Approve</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
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
        <Text style={styles.screenTitle}>Review Logs</Text>
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
                <Ionicons name="time-outline" size={12} color={colors.status.submitted} />
                <Text style={styles.statusBadgeText}>Awaiting Review</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            <Text style={styles.emptyTitle}>All Caught Up!</Text>
            <Text style={styles.emptyText}>
              No pending logs to review. Great job!
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

  // ─── Log Cards (list view) ───
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
    backgroundColor: colors.warning + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  logCardInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.warning,
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.status.submitted + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.status.submitted,
  },

  // ─── Detail View ───
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

  // Comparison table
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary + '30',
    marginBottom: spacing.xs,
  },
  compHeaderLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  compHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  compHeaderBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.info,
    textTransform: 'uppercase',
  },
  compHeaderStars: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gamification.gold,
    textTransform: 'uppercase',
  },
  comparisonRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  compLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
    marginBottom: 6,
  },
  compRatingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compScoreCol: {
    minWidth: 50,
    alignItems: 'flex-start',
  },
  compMentorCol: {
    alignItems: 'flex-end',
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.info + '12',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  scoreBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.info,
  },
  compNoScore: {
    fontSize: 12,
    color: colors.textDisabled,
    fontStyle: 'italic',
  },
  reflectionBox: {
    backgroundColor: colors.info + '08',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginTop: spacing.md,
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

  // Review form
  reviewFormCard: {
    borderWidth: 2,
    borderColor: colors.primary + '30',
  },
  reviewFormTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.md,
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  ratingLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
    flex: 1,
  },
  overallRatingRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 0,
    marginBottom: spacing.sm,
  },
  overallLabel: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
  },

  // Inputs
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  textArea: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.text,
    minHeight: 80,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  revisionInput: {
    minHeight: 60,
    borderColor: colors.error + '40',
  },
  revisionSection: {
    marginBottom: spacing.md,
  },
  revisionSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  revisionSectionHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkItemActive: {
    backgroundColor: colors.error + '08',
    borderColor: colors.error + '40',
  },
  checkLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
    flex: 1,
  },
  checkLabelActive: {
    color: colors.text,
  },
  additionalNotesWrap: {
    marginTop: spacing.sm,
  },

  // Action buttons
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
  approveBtn: {
    backgroundColor: colors.success,
  },
  approveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  rejectBtn: {
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: 'transparent',
  },
  rejectBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
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
