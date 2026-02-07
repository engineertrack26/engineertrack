import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/types/gamification';
import { colors, spacing, borderRadius } from '@/theme';
import { useTranslation } from 'react-i18next';

interface BadgeCardProps {
  badge: Badge;
  earned: boolean;
}

const TIER_COLORS = {
  bronze: colors.gamification.bronze,
  silver: colors.gamification.silver,
  gold: colors.gamification.gold,
};

export function BadgeCard({ badge, earned }: BadgeCardProps) {
  const { t } = useTranslation();
  const tierColor = TIER_COLORS[badge.tier];

  return (
    <View style={[styles.card, !earned && styles.cardLocked]}>
      <View
        style={[
          styles.iconContainer,
          { borderColor: earned ? tierColor : colors.border },
          earned && { backgroundColor: tierColor + '18' },
        ]}
      >
        {earned ? (
          <Ionicons
            name={badge.icon as keyof typeof Ionicons.glyphMap}
            size={28}
            color={tierColor}
          />
        ) : (
          <Ionicons name="lock-closed" size={24} color={colors.textDisabled} />
        )}
      </View>
      <Text style={[styles.name, !earned && styles.textLocked]} numberOfLines={1}>
        {t(badge.nameKey)}
      </Text>
      <Text style={[styles.description, !earned && styles.textLocked]} numberOfLines={2}>
        {t(badge.descriptionKey)}
      </Text>
      <View style={[styles.tierBadge, { backgroundColor: earned ? tierColor + '25' : colors.divider }]}>
        <Text style={[styles.tierText, { color: earned ? tierColor : colors.textDisabled }]}>
          {badge.tier.charAt(0).toUpperCase() + badge.tier.slice(1)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardLocked: {
    opacity: 0.6,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  description: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: spacing.sm,
  },
  textLocked: {
    color: colors.textDisabled,
  },
  tierBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  tierText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
