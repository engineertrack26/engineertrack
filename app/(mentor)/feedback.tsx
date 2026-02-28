import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { mentorService } from '@/services/mentor';
import { colors, spacing, borderRadius } from '@/theme';

interface FeedbackItem {
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

function mapFeedback(row: Record<string, unknown>): FeedbackItem {
  const dailyLog = row.daily_logs as Record<string, unknown> | null;
  let studentFirstName = '';
  let studentLastName = '';

  if (dailyLog) {
    const profile = dailyLog.profiles as Record<string, unknown> | null;
    studentFirstName = (profile?.first_name as string) || '';
    studentLastName = (profile?.last_name as string) || '';
  }

  return {
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

export default function FeedbackScreen() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const data = await mentorService.getFeedbackHistory(user.id);
      setFeedbacks(
        (data || []).map((f) => mapFeedback(f as unknown as Record<string, unknown>)),
      );
    } catch (err) {
      console.error('Feedback history load error:', err);
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

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

  const renderFeedback = ({ item }: { item: FeedbackItem }) => {
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
        {/* Top Row */}
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
              {item.isApproved ? 'Approved' : 'Revision'}
            </Text>
          </View>
        </View>

        {/* Log Title */}
        <Text style={styles.logTitle} numberOfLines={1}>{item.logTitle}</Text>

        {/* Rating */}
        <View style={styles.ratingRow}>
          <StarDisplay value={item.rating} />
          <Text style={styles.ratingText}>{item.rating}/5</Text>
        </View>

        {/* Comments */}
        <Text style={styles.comments} numberOfLines={2}>{item.comments}</Text>

        {/* Revision Notes — only show if not yet approved */}
        {!item.isApproved && item.revisionNotes ? (
          <View style={styles.revisionBox}>
            <Text style={styles.revisionLabel}>Revision Notes:</Text>
            <Text style={styles.revisionText} numberOfLines={2}>{item.revisionNotes}</Text>
          </View>
        ) : null}

        {/* Footer */}
        <Text style={styles.feedbackDate}>Reviewed {feedbackDate}</Text>
      </View>
    );
  };

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
        <Text style={styles.screenTitle}>Feedback History</Text>
        <Text style={styles.countText}>{feedbacks.length} review{feedbacks.length !== 1 ? 's' : ''}</Text>
      </View>

      <FlatList
        data={feedbacks}
        keyExtractor={(item) => item.id}
        renderItem={renderFeedback}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubble-outline" size={64} color={colors.textDisabled} />
            <Text style={styles.emptyTitle}>No Feedback Yet</Text>
            <Text style={styles.emptyText}>
              Your review history will appear here after you review student logs.
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
