import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useGamificationStore } from '@/store/gamificationStore';
import { studentGrowthViewService } from '@/services/studentGrowthView';
import { groupService } from '@/services/group';
import { useClosureStatus } from '@/hooks/useClosureStatus';
import { LoadFailedBanner, Stamp } from '@/components/common';
import { StudentHeader } from '@/components/student/StudentUI';
import { ui } from '@/components/common/workflowStyles';
import { growthBadges, growthLevel, growthReason } from '@/utils/studentGrowth';
import { colors } from '@/theme';
import { GrowthJourney } from '@/components/gamification/GrowthJourney';
import { LEVELS } from '@/types/gamification';

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
  const [showLegacy, setShowLegacy] = useState(false);
  const [showLevels, setShowLevels] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    groupService.getMyGroup(studentId).then(g => { if (current) setGroupId(g?.id ?? null); })
      .catch(error => console.warn('Group load for closure link failed:', error instanceof Error ? error.message : error));
    return () => { current = false; };
  }, [studentId]);
  const { status: closure } = useClosureStatus(studentId, groupId);
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
  const selfVsMentor = data?.selfVsMentor.status === 'fulfilled' ? data.selfVsMentor.value : null;
  const history = data?.history.status === 'fulfilled' ? (data.history.value || []).slice(0, 10) : null;
  const failed = !!data && Object.values(data).some((section) => section.status === 'rejected');
  const catalog = growthBadges(badges || new Set<string>());
  const legacyBadges = [...catalog.active,...catalog.historical].filter(badge=>badges?.has(badge.key));
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} colors={[colors.primaryDark]}
        onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <StudentHeader title={t('studentFlow.growth')} />
      <Text style={ui.secondary}>{t('growthUi.intro')}</Text>
      {!!closure?.closed && <View style={ui.card}>
        <Stamp kind="closed" date={closure.closedAt ? new Date(closure.closedAt).toLocaleDateString(i18n.language) : undefined} />
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: '/(student)/internship-report', params: { studentId, groupId: groupId! } })}>
          <Text style={styles.link}>{t('closure.myReport', 'My report')}</Text>
        </TouchableOpacity>
      </View>}
      {loading && !data ? <ActivityIndicator size="large" color={colors.primaryDark} /> : <>
        {failed && <LoadFailedBanner onRetry={() => void load()} />}
        {profile && level ? <View style={[ui.card, styles.featured]}>
          <View style={ui.header}><Ionicons name="trail-sign-outline" size={32} color={colors.primaryDark} />
            <View style={{ flex: 1, gap: 4 }}><Text style={ui.secondary}>{t('levelJourney.stage', { level: level.current.level, count: LEVELS.length })}</Text>
              <Text style={ui.cardTitle}>{t(level.current.nameKey)}</Text></View></View>
          <Text style={styles.xp}>{profile.totalXp.toLocaleString(i18n.language)} XP</Text>
          <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityLabel={t('growthUi.levelProgress')}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(level.progress * 100) }}>
            <View style={[styles.fill, { width: `${level.progress * 100}%` }]} />
          </View>
          <Text style={ui.body}>{level.next ? t('growthUi.nextLevel', { xp: level.remaining, level: level.next.level, name: t(level.next.nameKey) }) : t('levelJourney.maximum')}</Text>
          <Text style={ui.secondary}>{t('levelJourney.hint')}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showLevels }}
            onPress={() => setShowLevels(!showLevels)} style={styles.levelToggle}>
            <Text style={[styles.link, { flex: 1 }]}>{t(showLevels ? 'levelJourney.hide' : 'levelJourney.show')}</Text>
            <Ionicons name={showLevels ? 'chevron-up' : 'chevron-down'} size={22} color={colors.primaryDark} />
          </TouchableOpacity>
          {showLevels && <View style={{ gap: 12 }}>
            <Text style={ui.secondary}>{t('levelJourney.rules')}</Text>
            {LEVELS.map(stage => {
              const current = stage.level === level.current.level;
              const reached = stage.level < level.current.level;
              return <View key={stage.level} style={styles.levelRow}>
                <Ionicons name={current ? 'location-outline' : reached ? 'checkmark-circle-outline' : 'ellipse-outline'}
                  size={24} color={colors.primaryDark} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={ui.label}>{stage.level}. {t(stage.nameKey)}</Text>
                  <Text style={ui.secondary}>{t('levelJourney.threshold', { xp: stage.minXp.toLocaleString(i18n.language) })}</Text>
                  <Text style={current ? styles.link : ui.secondary}>{t(current ? 'levelJourney.current' : reached ? 'levelJourney.reached' : 'levelJourney.ahead')}</Text>
                </View>
              </View>;
            })}
          </View>}
        </View> : <Text style={ui.secondary}>{t('growthUi.unavailable')}</Text>}
        <View style={styles.wrap} accessibilityRole="tablist">
          {(['badges', 'competencies', 'history'] as const).map((value) => <TouchableOpacity key={value}
            accessibilityRole="tab" accessibilityState={{ selected: tab === value }}
            style={[styles.chip, tab === value && styles.featured]} onPress={() => setTab(value)}>
            <Text style={styles.link}>{t(value === 'badges' ? 'awardUi.title' : value === 'competencies' ? 'student.myCompetencies' : 'growthUi.history')}</Text>
          </TouchableOpacity>)}
        </View>
        {tab === 'badges' && <>
          <GrowthJourney metrics={data?.journey.status === 'fulfilled' ? data.journey.value : null}
            error={data?.journey.status === 'rejected' ? data.journey.reason : undefined} onRetry={() => void load()} />
          {legacyBadges.length > 0 && <>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:showLegacy}} onPress={()=>setShowLegacy(!showLegacy)} style={styles.action}>
              <Text style={styles.link}>{t('growthUi.historicalBadges')} {showLegacy?'−':'+'}</Text>
            </TouchableOpacity>
            {showLegacy && legacyBadges.map(badge=><View key={badge.key} style={ui.card}>
              <Text style={ui.label}>{t(badge.nameKey,{count:badge.requirement})}</Text>
              <Text style={ui.secondary}>{t('growthUi.earned')}</Text>
            </View>)}
          </>}
        </>}
        {tab === 'competencies' && (progress === null ? <Text style={ui.body}>{t('growthUi.unavailable')}</Text> :
          !progress.length ? <Text style={ui.body}>{t('growthUi.noCompetencies')}</Text> : <>
            {!!selfVsMentor?.length && <Text style={ui.secondary}>{t('assessment.gapHint')}</Text>}
            {progress.map((p) => {
              const row = selfVsMentor?.find((r) => r.competencyId === p.competencyId);
              return <View key={p.competencyId} style={ui.card}>
                <Text style={ui.cardTitle}>{p.name}</Text>
                <Text style={ui.body}>{t(p.currentLevel === 0 ? 'student.competencyNotStarted' : p.currentLevel >= p.targetLevel
                  ? 'student.competencyComplete' : 'student.competencyLevel', { current: p.currentLevel, target: p.targetLevel })}</Text>
                <Text style={ui.secondary}>{t('advisor.targetLevelShort', { level: p.targetLevel })}</Text>
                {!!row && <View style={{ gap: 6, marginTop: 8 }}>
                  <View style={styles.barRow}>
                    <Text style={styles.barLabel}>{t('assessment.you', 'You')}</Text>
                    <View style={styles.barTrack}><View style={[styles.barFill, { width: `${(row.avgSelf / 3) * 100}%`, backgroundColor: colors.info }]} /></View>
                    <Text style={styles.barValue}>{row.avgSelf.toFixed(1)}</Text>
                  </View>
                  <View style={styles.barRow}>
                    <Text style={styles.barLabel}>{t('assessment.mentor', 'Mentor')}</Text>
                    <View style={styles.barTrack}><View style={[styles.barFill, { width: `${(row.avgMentor / 3) * 100}%`, backgroundColor: colors.primary }]} /></View>
                    <Text style={styles.barValue}>{row.avgMentor.toFixed(1)}</Text>
                  </View>
                </View>}
              </View>;
            })}
          </>)}
        {tab === 'history' && (history === null ? <Text style={ui.body}>{t('growthUi.unavailable')}</Text> : <>
          <Text style={ui.secondary}>{t('growthUi.historyHint')}</Text>
          {!history.length && <Text style={ui.body}>{t('growthUi.noHistory')}</Text>}
          {history.map((tx: Record<string, unknown>) => {
            const amount = Number(tx.amount) || 0;
            const date = new Date(String(tx.created_at || ''));
            return <View key={String(tx.id)} style={ui.card}>
              <Text style={ui.label}>{t(growthReason(String(tx.reason || '')))}</Text>
              <Text style={[styles.link, { color: amount < 0 ? colors.error : colors.stamp }]}>{amount > 0 ? '+' : ''}{amount} XP</Text>
              {!Number.isNaN(date.getTime()) && <Text style={ui.secondary}>{date.toLocaleDateString(i18n.language)}</Text>}
            </View>;
          })}
        </>)}
        <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={() => router.push('/(student)/leaderboard')}>
          <Ionicons name="podium-outline" size={24} color={colors.primaryDark} />
          <Text style={[styles.link, { flex: 1 }]}>{t('growthUi.openRanking')}</Text>
          <Ionicons name="chevron-forward" size={22} color={colors.primaryDark} />
        </TouchableOpacity>
      </>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  levelToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  levelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.rule },
  featured: { borderColor: colors.ink, borderWidth: 1.5 },
  xp: { fontSize: 32, fontWeight: '700', color: colors.primaryDark },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.divider, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.primaryDark },
  action: { minHeight: 52, flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderWidth: 1, borderColor: colors.primaryDark, borderRadius: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, maxWidth: '100%', padding: 12, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: colors.divider },
  link: { fontSize: 16, fontWeight: '600', color: colors.primaryDark },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 52, fontSize: 12, color: colors.textSecondary },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.divider, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  barValue: { width: 28, fontSize: 12, textAlign: 'right', color: colors.textSecondary },
});
