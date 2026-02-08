import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { gamificationService } from '@/services/gamification';
import { LeaderboardRow } from '@/components/gamification';
import { colors, spacing, borderRadius } from '@/theme';

interface LeaderboardEntry {
  id: string;
  total_xp: number;
  current_level: number;
  current_streak: number;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
}

const PODIUM_COLORS = [
  colors.gamification.gold,
  colors.gamification.silver,
  colors.gamification.bronze,
];

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const data = await gamificationService.getLeaderboard(50);
      const mapped = (data || []).map((item: Record<string, unknown>) => {
        return {
          id: item.id as string,
          total_xp: item.total_xp as number,
          current_level: item.current_level as number,
          current_streak: item.current_streak as number,
          first_name: (item.first_name as string) || '',
          last_name: (item.last_name as string) || '',
          avatar_url: (item.avatar_url as string) || null,
        };
      });
      setEntries(mapped);
    } catch (err) {
      console.error('Leaderboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const maskName = (firstName: string, lastName: string) => {
    const first = (firstName || '').trim();
    const last = (lastName || '').trim();
    if (!first && !last) return 'Student';
    if (!last) return first;
    return `${first} ${last[0].toUpperCase()}.`;
  };

  const topThree = entries.slice(0, 3);
  const rest = entries.slice(3);

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
      <View style={styles.container}>
        <Text style={styles.header}>{t('student.leaderboard')}</Text>

        {entries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="podium-outline" size={48} color={colors.textDisabled} />
            <Text style={styles.emptyTitle}>No rankings yet</Text>
            <Text style={styles.emptyText}>Submit logs to appear on the leaderboard</Text>
          </View>
        ) : (
          <FlatList
            data={rest}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
            ListHeaderComponent={
              <>
                {/* Top 3 Podium */}
                {topThree.length > 0 && (
                  <View style={styles.podiumContainer}>
                    <View style={styles.podiumRow}>
                      {/* 2nd Place */}
                      {topThree.length > 1 ? (
                        <View style={styles.podiumItem}>
                          <View style={[styles.podiumAvatar, { borderColor: PODIUM_COLORS[1] }]}>
                            <Ionicons name="person" size={24} color={PODIUM_COLORS[1]} />
                          </View>
                          <Text style={styles.podiumName} numberOfLines={1}>
                            {maskName(topThree[1].first_name, topThree[1].last_name)}
                          </Text>
                          <Text style={styles.podiumXp}>{topThree[1].total_xp} XP</Text>
                          <View style={[styles.podiumBlock, styles.podiumSecond, { backgroundColor: PODIUM_COLORS[1] }]}>
                            <Text style={styles.podiumRank}>2</Text>
                          </View>
                        </View>
                      ) : <View style={styles.podiumItem} />}

                      {/* 1st Place */}
                      <View style={styles.podiumItem}>
                        <Ionicons name="trophy" size={24} color={PODIUM_COLORS[0]} style={styles.crownIcon} />
                        <View style={[styles.podiumAvatar, styles.podiumAvatarFirst, { borderColor: PODIUM_COLORS[0] }]}>
                          <Ionicons name="person" size={28} color={PODIUM_COLORS[0]} />
                        </View>
                        <Text style={[styles.podiumName, styles.podiumNameFirst]} numberOfLines={1}>
                          {maskName(topThree[0].first_name, topThree[0].last_name)}
                        </Text>
                        <Text style={styles.podiumXp}>{topThree[0].total_xp} XP</Text>
                        <View style={[styles.podiumBlock, styles.podiumFirst, { backgroundColor: PODIUM_COLORS[0] }]}>
                          <Text style={styles.podiumRank}>1</Text>
                        </View>
                      </View>

                      {/* 3rd Place */}
                      {topThree.length > 2 ? (
                        <View style={styles.podiumItem}>
                          <View style={[styles.podiumAvatar, { borderColor: PODIUM_COLORS[2] }]}>
                            <Ionicons name="person" size={24} color={PODIUM_COLORS[2]} />
                          </View>
                          <Text style={styles.podiumName} numberOfLines={1}>
                            {maskName(topThree[2].first_name, topThree[2].last_name)}
                          </Text>
                          <Text style={styles.podiumXp}>{topThree[2].total_xp} XP</Text>
                          <View style={[styles.podiumBlock, styles.podiumThird, { backgroundColor: PODIUM_COLORS[2] }]}>
                            <Text style={styles.podiumRank}>3</Text>
                          </View>
                        </View>
                      ) : <View style={styles.podiumItem} />}
                    </View>
                  </View>
                )}

                {rest.length > 0 && (
                  <View style={styles.listHeader}>
                    <Text style={styles.listHeaderText}>Rankings</Text>
                  </View>
                )}
              </>
            }
            renderItem={({ item, index }) => (
              <LeaderboardRow
                rank={index + 4}
                name={maskName(item.first_name, item.last_name)}
                xp={item.total_xp}
                level={item.current_level}
                isCurrentUser={item.id === user?.id}
              />
            )}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
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
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  podiumContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  podiumRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  podiumItem: {
    flex: 1,
    alignItems: 'center',
  },
  crownIcon: {
    marginBottom: 4,
  },
  podiumAvatar: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    marginBottom: spacing.xs,
  },
  podiumAvatarFirst: {
    width: 56,
    height: 56,
    borderWidth: 3,
  },
  podiumName: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  podiumNameFirst: {
    fontSize: 14,
    fontWeight: '700',
  },
  podiumXp: {
    fontSize: 11,
    color: colors.gamification.xp,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  podiumBlock: {
    width: '80%',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: borderRadius.sm,
    borderTopRightRadius: borderRadius.sm,
  },
  podiumFirst: {
    height: 60,
  },
  podiumSecond: {
    height: 44,
  },
  podiumThird: {
    height: 32,
  },
  podiumRank: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  listHeader: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  listHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
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
  },
});
