import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DailyLog, LogStatus } from '@/types/log';
import { colors, spacing, borderRadius } from '@/theme';

interface LogCardProps {
  log: DailyLog;
  onPress?: () => void;
}

const STATUS_CONFIG: Record<LogStatus, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  draft: { label: 'Draft', color: colors.status.draft, icon: 'document-outline' },
  submitted: { label: 'Submitted', color: colors.status.submitted, icon: 'send-outline' },
  under_review: { label: 'Under Review', color: colors.status.underReview, icon: 'time-outline' },
  approved: { label: 'Approved', color: colors.status.approved, icon: 'checkmark-circle-outline' },
  needs_revision: { label: 'Needs Revision', color: colors.status.needsRevision, icon: 'alert-circle-outline' },
  revised: { label: 'Revised', color: colors.status.revised, icon: 'refresh-outline' },
  validated: { label: 'Validated', color: colors.status.validated, icon: 'shield-checkmark-outline' },
};

export function LogCard({ log, onPress }: LogCardProps) {
  const statusConfig = STATUS_CONFIG[log.status];
  const formattedDate = new Date(log.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View style={styles.header}>
        <Text style={styles.date}>{formattedDate}</Text>
        <View style={[styles.badge, { backgroundColor: statusConfig.color + '18' }]}>
          <Ionicons name={statusConfig.icon} size={14} color={statusConfig.color} />
          <Text style={[styles.badgeText, { color: statusConfig.color }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={1}>{log.title}</Text>
      <Text style={styles.content} numberOfLines={2}>{log.content}</Text>
      {log.xpEarned > 0 && (
        <View style={styles.xpRow}>
          <Ionicons name="flash" size={14} color={colors.gamification.xp} />
          <Text style={styles.xpText}>+{log.xpEarned} XP</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  date: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  content: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: 4,
  },
  xpText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gamification.xp,
  },
});
