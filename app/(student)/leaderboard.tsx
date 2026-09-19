import { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { gamificationService } from '@/services/gamification';
import { colors } from '@/theme';
import { BackButton, LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { leaderboardName } from '@/utils/studentGrowth';

interface Entry { id: string; xp: number; level: number; first: string; initial: string }

export default function LeaderboardScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  return userId ? <RankingContent key={userId} studentId={userId} /> : null;
}
function RankingContent({ studentId }: { studentId: string }) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    const current = () => request === sequence.current && useAuthStore.getState().user?.id === studentId;
    try {
      const data = await gamificationService.getGroupLeaderboard(50);
      if (!current()) return;
      // Keep server order, including its tie-breaking; never re-rank locally.
      setEntries(data.map((row: Record<string, unknown>) => ({ id: String(row.id), xp: Number(row.total_xp) || 0,
        level: Number(row.current_level) || 1, first: String(row.first_name || ''), initial: String(row.last_initial || '') })));
      setFailed(false);
    } catch {
      if (current()) { setEntries([]); setFailed(true); }
    } finally { if (current()) { setLoading(false); setRefreshing(false); } }
  }, [studentId]);
  useFocusEffect(useCallback(() => { void load(); return () => { sequence.current += 1; }; }, [load]));
  const myIndex = entries.findIndex((entry) => entry.id === studentId);
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <FlatList data={entries} keyExtractor={(entry) => entry.id} contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} colors={[colors.primaryDark]}
        onRefresh={() => { setRefreshing(true); void load(); }} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <BackButton href="/(student)/achievements" />
        <Text style={ui.title} accessibilityRole="header">{t('student.leaderboard')}</Text>
        <Text style={ui.secondary}>{t('growthUi.rankingHint')}</Text>
        {failed && <LoadFailedBanner onRetry={() => void load()} />}
        {!loading && !failed && entries.length > 0 && <View style={[ui.card, styles.mine]}>
          <Text style={ui.label}>{t('growthUi.yourPlace')}</Text>
          {myIndex >= 0 ? <>
            <Text style={styles.rank}>#{myIndex + 1}</Text>
            <Text style={ui.body}>{entries[myIndex].xp.toLocaleString(i18n.language)} XP · {t('gamification.level')} {entries[myIndex].level}</Text>
          </> : <Text style={ui.secondary}>{t('growthUi.notListed')}</Text>}
        </View>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primaryDark} /> :
        !failed ? <View style={ui.card}>
          <Ionicons name="podium-outline" size={32} color={colors.primaryDark} />
          <Text style={ui.section}>{t('flow.rankingEmpty')}</Text>
          <Text style={ui.secondary}>{t('flow.rankingHint')}</Text>
          <TouchableOpacity style={ui.primary} accessibilityRole="button" onPress={() => router.push('/(student)/my-tasks')}>
            <Text style={ui.primaryText}>{t('student.myTasks')}</Text>
          </TouchableOpacity>
        </View> : null}
      renderItem={({ item, index }) => <View style={[ui.card, item.id === studentId && styles.mine]}>
        <View style={ui.header}>
          <View style={styles.position}><Text style={styles.positionText}>#{index + 1}</Text></View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={ui.cardTitle}>{leaderboardName(item.first, item.initial, t('growthUi.student'))}</Text>
            {item.id === studentId && <Text style={styles.you}>{t('growthUi.you')}</Text>}
          </View>
          {index < 3 && <Ionicons name="trophy-outline" size={24} color="#805400" />}
        </View>
        <Text style={ui.label}>{item.xp.toLocaleString(i18n.language)} XP</Text>
        <Text style={ui.secondary}>{t('gamification.level')} {item.level}</Text>
      </View>} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  mine: { borderColor: colors.ink, borderWidth: 1.5 },
  rank: { fontSize: 32, fontWeight: '600', color: colors.ink, fontVariant: ['tabular-nums'] },
  position: { minWidth: 48, minHeight: 48, borderRadius: 6, padding: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.page },
  positionText: { fontSize: 18, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  you: { fontSize: 14, color: colors.ink, fontWeight: '600' },
});
