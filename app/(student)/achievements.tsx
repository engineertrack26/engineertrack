import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { studentGrowthViewService } from '@/services/studentGrowthView';
import { LoadFailedBanner } from '@/components/common';
import { StudentHeader } from '@/components/student/StudentUI';
import { ui } from '@/components/common/workflowStyles';
import { BADGES } from '@/types/gamification';
import { growthLevel, growthReason } from '@/utils/studentGrowth';
import { colors } from '@/theme';

type GrowthData = Awaited<ReturnType<typeof studentGrowthViewService.load>>;

export default function AchievementsScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  return userId ? <GrowthContent key={userId} studentId={userId} /> : null;
}
function GrowthContent({ studentId }: { studentId: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<GrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'badges' | 'competencies' | 'history'>('badges');
  const [earnedOnly, setEarnedOnly] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    const result = await studentGrowthViewService.load(studentId);
    if (sequence.current !== request || useAuthStore.getState().user?.id !== studentId) return;
    setData(result);
    // Keep the existing shared counters in sync, only after a successful read
    // for the account that is still signed in. The screen never renders old store values.
    const store = useGamificationStore.getState();
    if (result.profile.status === 'fulfilled') {
      const profile = result.profile.value;
      store.setXp(profile.totalXp); store.setLevel(profile.currentLevel);
      store.setStreak(profile.currentStreak, profile.longestStreak);
    }
    if (result.badges.status === 'fulfilled')
      store.setEarnedBadges((result.badges.value || []).map((badge: Record<string, unknown>) => badge.badge_key as string));
    setLoading(false); setRefreshing(false);
  }, [studentId]);
  useFocusEffect(useCallback(() => {
    void load(); return () => { sequence.current += 1; };
  }, [load]));
  const profile = data?.profile.status === 'fulfilled' ? data.profile.value : null;
  const level = profile ? growthLevel(profile.totalXp, profile.currentLevel) : null;
  const badges = data?.badges.status === 'fulfilled'
    ? new Set((data.badges.value || []).map((badge: Record<string, unknown>) => badge.badge_key as string)) : null;
  const progress = data?.competencies.status === 'fulfilled' ? data.competencies.value : null;
  const history = data?.history.status === 'fulfilled' ? (data.history.value || []).slice(0, 10) : null;
  const failed = !!data && Object.values(data).some((section) => section.status === 'rejected');
  const shownBadges = BADGES.filter((badge) => !earnedOnly || badges?.has(badge.key));
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} colors={[colors.primaryDark]}
        onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <StudentHeader title={t('studentFlow.growth')} />
      <Text style={ui.secondary}>{t('growthUi.intro')}</Text>
      {loading && !data ? <ActivityIndicator size="large" color={colors.primaryDark} /> : <>
        {failed && <LoadFailedBanner onRetry={() => void load()} />}
        {profile && level ? <View style={[ui.card, styles.featured]}>
          <View style={ui.header}><Ionicons name="shield-checkmark-outline" size={32} color={colors.primaryDark} />
            <View style={{ flex: 1, gap: 4 }}><Text style={ui.secondary}>{t('gamification.level')} {profile.currentLevel}</Text>
              <Text style={ui.cardTitle}>{t(level.current.nameKey)}</Text></View></View>
          <Text style={styles.xp}>{profile.totalXp.toLocaleString(i18n.language)} XP</Text>
          <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityLabel={t('growthUi.levelProgress')}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(level.progress * 100) }}>
            <View style={[styles.fill, { width: `${level.progress * 100}%` }]} />
          </View>
          <Text style={ui.body}>{level.next ? t('growthUi.nextLevel', { xp: level.remaining, level: level.next.level, name: t(level.next.nameKey) }) : t('growthUi.maximum')}</Text>
        </View> : <Text style={ui.secondary}>{t('growthUi.unavailable')}</Text>}
        <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => router.push('/(student)/leaderboard')}>
          <Ionicons name="podium-outline" size={24} color={colors.primaryDark} />
          <Text style={[styles.link, { flex: 1 }]}>{t('growthUi.openRanking')}</Text>
          <Ionicons name="chevron-forward" size={22} color={colors.primaryDark} />
        </TouchableOpacity>
        <View style={styles.wrap} accessibilityRole="tablist">
          {(['badges', 'competencies', 'history'] as const).map((value) => <TouchableOpacity key={value}
            accessibilityRole="tab" accessibilityState={{ selected: tab === value }}
            style={[styles.chip, tab === value && styles.featured]} onPress={() => setTab(value)}>
            <Text style={styles.link}>{t(value === 'badges' ? 'gamification.badges' : value === 'competencies' ? 'student.myCompetencies' : 'growthUi.history')}</Text>
          </TouchableOpacity>)}
        </View>
        {tab === 'badges' && (badges === null ? <Text style={ui.body}>{t('growthUi.unavailable')}</Text> : <>
          <Text style={ui.secondary}>{t('growthUi.badgeCount', { count: BADGES.filter((badge) => badges.has(badge.key)).length, total: BADGES.length })}</Text>
          <View style={styles.wrap}>{[false, true].map((value) => <TouchableOpacity key={String(value)}
            accessibilityRole="button" accessibilityState={{ selected: earnedOnly === value }}
            style={[styles.chip, value === earnedOnly && styles.featured]} onPress={() => setEarnedOnly(value)}>
            <Text style={styles.link}>{t(value ? 'growthUi.earned' : 'growthUi.allBadges')}</Text>
          </TouchableOpacity>)}</View>
          {!shownBadges.length && <Text style={ui.body}>{t('growthUi.noBadges')}</Text>}
          {shownBadges.map((badge) => {
            const earned = badges.has(badge.key);
            return <View key={badge.id} style={ui.card}>
              <View style={ui.header}><Ionicons name={earned ? 'ribbon-outline' : 'lock-closed-outline'} size={28} color={colors.primaryDark} />
                <Text style={[ui.cardTitle, { flex: 1 }]}>{t(badge.nameKey)}</Text></View>
              <Text style={ui.body}>{t(badge.descriptionKey)}</Text>
              <Text style={ui.secondary}>{t(earned ? 'growthUi.earned' : 'growthUi.notEarned')} · {t('growthUi.' + badge.tier)}</Text>
            </View>;
          })}
        </>)}
        {tab === 'competencies' && (progress === null ? <Text style={ui.body}>{t('growthUi.unavailable')}</Text> :
          !progress.length ? <Text style={ui.body}>{t('growthUi.noCompetencies')}</Text> :
            progress.map((p) => <View key={p.competencyId} style={ui.card}>
              <Text style={ui.cardTitle}>{p.name}</Text>
              <Text style={ui.body}>{t(p.currentLevel === 0 ? 'student.competencyNotStarted' : p.currentLevel >= p.targetLevel
                ? 'student.competencyComplete' : 'student.competencyLevel', { current: p.currentLevel, target: p.targetLevel })}</Text>
              <Text style={ui.secondary}>{t('advisor.targetLevelShort', { level: p.targetLevel })}</Text>
            </View>))}
        {tab === 'history' && (history === null ? <Text style={ui.body}>{t('growthUi.unavailable')}</Text> : <>
          <Text style={ui.secondary}>{t('growthUi.historyHint')}</Text>
          {!history.length && <Text style={ui.body}>{t('growthUi.noHistory')}</Text>}
          {history.map((tx: Record<string, unknown>) => {
            const amount = Number(tx.amount) || 0;
            const date = new Date(String(tx.created_at || ''));
            return <View key={String(tx.id)} style={ui.card}>
              <Text style={ui.label}>{t(growthReason(String(tx.reason || '')))}</Text>
              <Text style={[styles.link, { color: amount < 0 ? '#a52929' : '#21613e' }]}>{amount > 0 ? '+' : ''}{amount} XP</Text>
              {!Number.isNaN(date.getTime()) && <Text style={ui.secondary}>{date.toLocaleDateString(i18n.language)}</Text>}
            </View>;
          })}
        </>)}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  featured: { backgroundColor: '#eaf1fb', borderColor: '#b8ccea' },
  xp: { fontSize: 32, fontWeight: '700', color: colors.primaryDark },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.divider, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.primaryDark },
  action: { minHeight: 52, flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderWidth: 1, borderColor: colors.primaryDark, borderRadius: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, maxWidth: '100%', padding: 12, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.divider },
  link: { fontSize: 16, fontWeight: '600', color: colors.primaryDark },
});
