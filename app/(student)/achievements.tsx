import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { gamificationService } from '@/services/gamification';
import { supabase } from '@/services/supabase';
import { ProgressBar } from '@/components/common';
import { BadgeCard } from '@/components/gamification';
import { BADGES, LEVELS } from '@/types/gamification';
import { colors, spacing, borderRadius } from '@/theme';

interface XpTransaction {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

export default function AchievementsScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { totalXp, currentLevel, earnedBadges, setEarnedBadges, setXp, setLevel, setStreak } =
    useGamificationStore();
  const [xpHistory, setXpHistory] = useState<XpTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentLevelData = LEVELS.find((l) => l.level === currentLevel) || LEVELS[0];
  const nextLevelData = LEVELS.find((l) => l.level === currentLevel + 1);
  const xpProgress = nextLevelData
    ? (totalXp - currentLevelData.minXp) / (nextLevelData.minXp - currentLevelData.minXp)
    : 1;
  const xpToNextLevel = nextLevelData ? nextLevelData.minXp - totalXp : 0;

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [badges, history, profileRes] = await Promise.all([
        gamificationService.getEarnedBadges(user.id),
        gamificationService.getXpHistory(user.id),
        supabase
          .from('student_profiles')
          .select('total_xp, current_level, current_streak, longest_streak')
          .eq('id', user.id)
          .single(),
      ]);

      setEarnedBadges((badges || []).map((b: Record<string, unknown>) => b.badge_key as string));
      setXpHistory((history || []).slice(0, 10) as XpTransaction[]);

      if (profileRes.data) {
        setXp(profileRes.data.total_xp || 0);
        setLevel(profileRes.data.current_level || 1);
        setStreak(
          profileRes.data.current_streak || 0,
          profileRes.data.longest_streak || 0,
        );
      }
    } catch (err) {
      console.error('Achievements load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, setEarnedBadges, setXp, setLevel, setStreak]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const formatReason = (reason: string): string => {
    return reason
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
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
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <Text style={styles.header}>{t('student.achievements')}</Text>

        {/* Level Section */}
        <View style={styles.levelCard}>
          <View style={styles.levelHeader}>
            <View style={styles.levelIcon}>
              <Ionicons name="shield-checkmark" size={28} color={colors.gamification.levelUp} />
            </View>
            <View style={styles.levelInfo}>
              <Text style={styles.levelLabel}>{t('gamification.level')} {currentLevel}</Text>
              <Text style={styles.levelName}>{t(currentLevelData.nameKey)}</Text>
            </View>
            <View style={styles.xpBadge}>
              <Ionicons name="flash" size={14} color={colors.gamification.xp} />
              <Text style={styles.xpBadgeText}>{totalXp} XP</Text>
            </View>
          </View>
          <ProgressBar
            progress={xpProgress}
            color={colors.gamification.levelUp}
            height={10}
          />
          {nextLevelData ? (
            <Text style={styles.xpHint}>
              {xpToNextLevel} XP to {t(nextLevelData.nameKey)} (Level {nextLevelData.level})
            </Text>
          ) : (
            <Text style={styles.xpHint}>Maximum level reached!</Text>
          )}
        </View>

        {/* Badges Grid */}
        <Text style={styles.sectionTitle}>{t('gamification.badges')}</Text>
        <View style={styles.badgesGrid}>
          {BADGES.map((badge, index) => {
            const isEarned = earnedBadges.includes(badge.key);
            return (
              <View
                key={badge.id}
                style={[
                  styles.badgeWrapper,
                  index % 2 === 0 ? styles.badgeLeft : styles.badgeRight,
                ]}
              >
                <BadgeCard badge={badge} earned={isEarned} />
              </View>
            );
          })}
        </View>

        {/* XP History */}
        {xpHistory.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recent XP</Text>
            <View style={styles.historyCard}>
              {xpHistory.map((tx, i) => (
                <View
                  key={tx.id}
                  style={[styles.historyRow, i < xpHistory.length - 1 && styles.historyBorder]}
                >
                  <View style={styles.historyLeft}>
                    <Ionicons
                      name={tx.amount > 0 ? 'arrow-up-circle' : 'arrow-down-circle'}
                      size={20}
                      color={tx.amount > 0 ? colors.success : colors.error}
                    />
                    <Text style={styles.historyReason}>{formatReason(tx.reason)}</Text>
                  </View>
                  <Text
                    style={[
                      styles.historyAmount,
                      { color: tx.amount > 0 ? colors.success : colors.error },
                    ]}
                  >
                    {tx.amount > 0 ? '+' : ''}{tx.amount} XP
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
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
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  levelCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  levelIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.gamification.levelUp + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  levelInfo: {
    flex: 1,
  },
  levelLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  levelName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  xpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gamification.xp + '15',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  xpBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.gamification.xp,
  },
  xpHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.lg,
  },
  badgeWrapper: {
    width: '50%',
    marginBottom: spacing.sm,
  },
  badgeLeft: {
    paddingRight: spacing.xs,
  },
  badgeRight: {
    paddingLeft: spacing.xs,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  historyBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  historyReason: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  historyAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
});
