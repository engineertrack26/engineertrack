import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { mentorService } from '@/services/mentor';
import { colors, spacing, borderRadius } from '@/theme';
import { BackButton, LoadFailedBanner } from '@/components/common';

// Two distinct histories, never merged into one shape: a task review has an
// outcome and a note, a legacy log review has a 1-5 rating. Forcing them into
// one interface is how you end up with a card that shows stars for a task
// that was never rated, or an outcome column blank for an old log review.
interface TaskFeedbackItem {
  kind: 'task';
  id: string;
  assignmentTitle: string;
  note: string;
  approved: boolean;
  reviewedAt: string;
  studentFirstName: string;
  studentLastName: string;
}

interface LegacyFeedbackItem {
  kind: 'legacy';
  id: string;
  logId: string;
  rating: number;
  comments: string;
  isApproved: boolean;
  revisionNotes?: string;
  createdAt: string;
  studentFirstName: string;
  studentLastName: string;
  logTitle: string;
  logDate: string;
}

type FeedbackItem = TaskFeedbackItem | LegacyFeedbackItem;

interface FeedbackSection {
  key: string;
  title: string;
  hint?: string;
  data: FeedbackItem[];
}

function mapTaskFeedback(row: Record<string, unknown>): TaskFeedbackItem {
  const assignment = row.group_assignments as Record<string, unknown> | null;
  const profile = row.profiles as Record<string, unknown> | null;
  return {
    kind: 'task',
    id: row.id as string,
    assignmentTitle: (assignment?.title as string) || '',
    note: (row.mentor_note as string) || '',
    approved: (row.status as string) === 'approved',
    reviewedAt: (row.reviewed_at as string) || '',
    studentFirstName: (profile?.first_name as string) || '',
    studentLastName: (profile?.last_name as string) || '',
  };
}

function mapLegacyFeedback(row: Record<string, unknown>): LegacyFeedbackItem {
  const dailyLog = row.daily_logs as Record<string, unknown> | null;
  let studentFirstName = '';
  let studentLastName = '';

  if (dailyLog) {
    const profile = dailyLog.profiles as Record<string, unknown> | null;
    studentFirstName = (profile?.first_name as string) || '';
    studentLastName = (profile?.last_name as string) || '';
  }

  return {
    kind: 'legacy',
    id: row.id as string,
    logId: (row.log_id as string) || '',
    rating: (row.rating as number) || 0,
    comments: (row.comments as string) || '',
    isApproved: (row.is_approved as boolean) || false,
    revisionNotes: (row.revision_notes as string) || undefined,
    createdAt: (row.created_at as string) || '',
    studentFirstName,
    studentLastName,
    logTitle: (dailyLog?.title as string) || '',
    logDate: (dailyLog?.date as string) || '',
  };
}

function StarDisplay({ value, size = 14 }: { value: number; size?: number }) {
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

const getInitials = (first: string, last: string) =>
  `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

export default function FeedbackScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [taskFeedback, setTaskFeedback] = useState<TaskFeedbackItem[]>([]);
  const [legacyFeedback, setLegacyFeedback] = useState<LegacyFeedbackItem[]>([]);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoadFailed(false);
    try {
      // Two independent histories -- the task path (assignment_submissions
      // this mentor reviewed) and what predates it (mentor_feedbacks, still
      // real). Neither is dropped; they render as separately-labelled groups
      // below.
      const [taskData, legacyData] = await Promise.all([
        mentorService.getFeedbackHistory(user.id),
        mentorService.getLegacyFeedbackHistory(user.id),
      ]);
      setTaskFeedback(
        (taskData || []).map((f) => mapTaskFeedback(f as unknown as Record<string, unknown>)),
      );
      setLegacyFeedback(
        (legacyData || []).map((f) => mapLegacyFeedback(f as unknown as Record<string, unknown>)),
      );
    } catch (err) {
      console.error('Feedback history load error:', err);
      setLoadFailed(true);
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

  const renderTaskCard = (item: TaskFeedbackItem) => {
    const reviewedDate = item.reviewedAt
      ? new Date(item.reviewedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatarContainer}>
            <Text style={styles.initials}>
              {getInitials(item.studentFirstName, item.studentLastName)}
            </Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.studentName} numberOfLines={1}>
              {item.studentFirstName} {item.studentLastName}
            </Text>
            <Text style={styles.logDate}>{reviewedDate}</Text>
          </View>
          <View style={[styles.statusBadge, item.approved ? styles.approvedBadge : styles.rejectedBadge]}>
            <Ionicons
              name={item.approved ? 'checkmark-circle' : 'refresh-outline'}
              size={13}
              color={item.approved ? colors.success : colors.error}
            />
            <Text
              style={[
                styles.statusText,
                { color: item.approved ? colors.success : colors.error },
              ]}
            >
              {item.approved ? t('mentor.statusApproved') : t('mentor.statusRevision')}
            </Text>
          </View>
        </View>

        <Text style={styles.logTitle}>{item.assignmentTitle}</Text>

        {!!item.note && (
          <Text style={styles.comments} selectable>{item.note}</Text>
        )}
      </View>
    );
  };

  const renderLegacyCard = (item: LegacyFeedbackItem) => {
    const formattedDate = item.logDate
      ? new Date(item.logDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '';
    const feedbackDate = item.createdAt
      ? new Date(item.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
      : '';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatarContainer}>
            <Text style={styles.initials}>
              {getInitials(item.studentFirstName, item.studentLastName)}
            </Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.studentName} numberOfLines={1}>
              {item.studentFirstName} {item.studentLastName}
            </Text>
            <Text style={styles.logDate}>{formattedDate}</Text>
          </View>
          <View style={[styles.statusBadge, item.isApproved ? styles.approvedBadge : styles.rejectedBadge]}>
            <Ionicons
              name={item.isApproved ? 'checkmark-circle' : 'refresh-outline'}
              size={13}
              color={item.isApproved ? colors.success : colors.error}
            />
            <Text
              style={[
                styles.statusText,
                { color: item.isApproved ? colors.success : colors.error },
              ]}
            >
              {item.isApproved ? t('mentor.statusApproved') : t('mentor.statusRevision')}
            </Text>
          </View>
        </View>

        <Text style={styles.logTitle}>{item.logTitle}</Text>

        <View style={styles.ratingRow}>
          <StarDisplay value={item.rating} />
          <Text style={styles.ratingText}>{item.rating}/5</Text>
        </View>

        <Text style={styles.comments} selectable>{item.comments}</Text>

        {!item.isApproved && item.revisionNotes ? (
          <View style={styles.revisionBox}>
            <Text style={styles.revisionLabel}>Revision Notes:</Text>
            <Text style={styles.revisionText} selectable>{item.revisionNotes}</Text>
          </View>
        ) : null}

        <Text style={styles.feedbackDate}>Reviewed {feedbackDate}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={{ paddingHorizontal: spacing.lg }}><BackButton href="/(mentor)/dashboard" /></View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const totalCount = taskFeedback.length + legacyFeedback.length;

  // The old mentor_feedbacks rows are real feedback, not a fallback -- they
  // stay visible in their own labelled group rather than being dropped or
  // rendered with a blank star column now that the task path has no rating.
  const sections: FeedbackSection[] = [];
  if (taskFeedback.length > 0) {
    sections.push({ key: 'task', title: t('mentor.taskFeedback'), data: taskFeedback });
  }
  if (legacyFeedback.length > 0) {
    sections.push({
      key: 'legacy',
      title: t('mentor.earlierFeedback'),
      hint: t('mentor.earlierFeedbackHint'),
      data: legacyFeedback,
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={{ paddingHorizontal: spacing.lg }}><BackButton href="/(mentor)/dashboard" /></View>
      <View style={styles.headerContainer}>
        <Text style={styles.screenTitle}>{t('mentorHome.history')}</Text>
        <Text style={styles.countText}>{t('mentor.reviewCount', { count: totalCount })}</Text>
      </View>

      <SectionList<FeedbackItem, FeedbackSection>
        sections={sections}
        ListHeaderComponent={loadFailed ? <LoadFailedBanner onRetry={loadData} /> : null}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (item.kind === 'task' ? renderTaskCard(item) : renderLegacyCard(item))}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
            {!!section.hint && <Text style={styles.sectionHeaderHint}>{section.hint}</Text>}
          </View>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubble-outline" size={64} color={colors.textDisabled} />
            <Text style={styles.emptyTitle}>{t('mentor.noFeedbackYet')}</Text>
            <Text style={styles.emptyText}>{t('mentor.noFeedbackYetDesc')}</Text>
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
    color: colors.textSecondary,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },

  // Section headers
  sectionHeaderRow: {
    backgroundColor: colors.background,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  sectionHeaderText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  sectionHeaderHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Card
  card: {
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
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  initials: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  cardInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  logDate: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },

  // Status badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    marginLeft: spacing.sm,
  },
  approvedBadge: {
    backgroundColor: colors.success + '15',
  },
  rejectedBadge: {
    backgroundColor: colors.error + '15',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Content
  logTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gamification.gold,
  },
  comments: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Revision
  revisionBox: {
    backgroundColor: colors.error + '08',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
  },
  revisionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.error,
    marginBottom: 2,
  },
  revisionText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },

  // Footer
  feedbackDate: {
    fontSize: 11,
    color: colors.textDisabled,
    marginTop: spacing.sm,
    textAlign: 'right',
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
