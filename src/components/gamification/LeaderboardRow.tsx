import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '@/theme';

interface LeaderboardRowProps {
  rank: number;
  name: string;
  xp: number;
  level: number;
  isCurrentUser: boolean;
}

const RANK_COLORS: Record<number, string> = {
  1: colors.gamification.gold,
  2: colors.gamification.silver,
  3: colors.gamification.bronze,
};

export function LeaderboardRow({ rank, name, xp, level, isCurrentUser }: LeaderboardRowProps) {
  const rankColor = RANK_COLORS[rank];
  const isTopThree = rank <= 3;

  return (
    <View style={[styles.row, isCurrentUser && styles.currentUserRow]}>
      <View style={styles.rankContainer}>
        {isTopThree ? (
          <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
            <Text style={styles.rankBadgeText}>{rank}</Text>
          </View>
        ) : (
          <Text style={styles.rankText}>{rank}</Text>
        )}
      </View>
      <View style={styles.avatarContainer}>
        <Ionicons name="person-circle" size={36} color={isCurrentUser ? colors.primary : colors.textDisabled} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, isCurrentUser && styles.currentUserName]} numberOfLines={1}>
          {name}
          {isCurrentUser && ' (You)'}
        </Text>
        <Text style={styles.levelText}>Level {level}</Text>
      </View>
      <View style={styles.xpContainer}>
        <Ionicons name="flash" size={14} color={colors.gamification.xp} />
        <Text style={styles.xpText}>{xp.toLocaleString()}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  currentUserRow: {
    backgroundColor: colors.primary + '0A',
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  rankContainer: {
    width: 32,
    alignItems: 'center',
  },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  rankText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  avatarContainer: {
    marginHorizontal: spacing.sm,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  currentUserName: {
    color: colors.primary,
  },
  levelText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  xpContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  xpText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.gamification.xp,
  },
});
