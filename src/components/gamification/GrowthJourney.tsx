import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import type { GrowthJourneyData, GrowthStage } from '@/types/growthJourney';
import { GROWTH_FAMILIES, growthStages, nextGrowthStages } from '@/utils/growthJourney';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

export function GrowthJourney({ metrics, error, onRetry }: { metrics: GrowthJourneyData | null; error?: unknown; onRetry: () => void }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [earnedOnly, setEarnedOnly] = useState(false);
  if (!metrics) return <View style={ui.card}>
    <Text style={ui.label}>{t('awardUi.title')}</Text>
    <Text style={ui.body}>{t((error as { code?: string })?.code === 'PGRST202' ? 'journeyUi.notInstalled' : 'growthUi.unavailable')}</Text>
    <Pressable accessibilityRole="button" onPress={onRetry} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={ui.link}>{t('common.retry')}</Text></Pressable>
  </View>;
  const stages = growthStages(metrics);
  const next = nextGrowthStages(stages);
  const currentAwards = metrics.awards.filter(a => a.groupId === metrics.groupId);
  const stage = (s: GrowthStage) => {
    const award = currentAwards.find(a => a.stageId === s.id);
    return <View key={s.id} style={[ui.card, !s.available && { borderStyle: 'dashed' }]}>
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Ionicons name={award?.verified ? 'ribbon' : award ? 'alert-circle-outline' : 'lock-closed-outline'} size={26} color={colors.primaryDark} />
      <Text style={[ui.label, { flex: 1 }]}>{s.label ? t('journeyUi.' + s.label) : `${t('journeyUi.' + s.family)} · ${s.target}`}</Text>
    </View>
    {!s.label && <>
      <Text style={ui.body}>{t('journeyUi.progress', { current: Math.min(s.current, s.target), target: s.target })}</Text>
      <View accessibilityRole="progressbar" accessibilityLabel={t('journeyUi.' + s.family)}
        accessibilityValue={{ min: 0, max: s.target, now: Math.min(s.current, s.target) }}
        style={{ height: 8, backgroundColor: colors.divider, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: 8, backgroundColor: colors.primaryDark, width: `${Math.min(1, s.current / s.target) * 100}%` }} />
      </View>
    </>}
    <Text style={ui.secondary}>{t(award ? award.verified ? 'growthUi.earned' : 'awardUi.recheck' : !s.available
      ? s.label === 'closed' ? 'journeyUi.closureUnavailable' : 'journeyUi.unavailable' : 'journeyUi.inProgress')}</Text>
    {award && <Text style={ui.secondary}>{t('awardUi.earnedAt', {date:new Date(award.earnedAt).toLocaleDateString(i18n.language)})}</Text>}
  </View>;
  };
  return <View style={{ gap: 12 }}>
    <Text style={ui.section}>{t('awardUi.title')}</Text>
    <Text style={ui.secondary}>{t('awardUi.hint')}</Text>
    <View style={{ flexDirection:'row',flexWrap:'wrap',gap:8 }}>
      {[false,true].map(only=><Pressable key={String(only)} accessibilityRole="button" accessibilityState={{selected:earnedOnly===only}}
        onPress={()=>setEarnedOnly(only)} style={[ui.card,{minHeight:48,padding:12},earnedOnly===only&&{borderColor:colors.primaryDark}]}>
        <Text style={ui.link}>{t(only?'growthUi.earned':'growthUi.allBadges')}</Text>
      </Pressable>)}
    </View>
    {earnedOnly ? <>
      {!metrics.awards.length && <Text style={ui.body}>{t('growthUi.noBadges')}</Text>}
      {metrics.awards.map(a=><View key={`${a.groupId}:${a.stageId}`} style={ui.card}>
        <Text style={ui.label}>{a.label?t('journeyUi.'+a.label):`${t('journeyUi.'+a.family)} · ${a.target}`}</Text>
        <Text style={ui.secondary}>{t(a.groupId!==metrics.groupId?'awardUi.previousGroup':a.verified?'growthUi.earned':'awardUi.recheck')}</Text>
        <Text style={ui.secondary}>{t('awardUi.earnedAt',{date:new Date(a.earnedAt).toLocaleDateString(i18n.language)})}</Text>
      </View>)}
    </> : !metrics.groupId ? <Text style={ui.body}>{t('student.noGroupTasks')}</Text> : <>
    <Text style={ui.label}>{t('growthUi.badgeCount',{count:stages.filter(s=>currentAwards.some(a=>a.stageId===s.id&&a.verified)).length,total:stages.length})}</Text>
    <Text style={ui.label}>{t('journeyUi.next')}</Text>
    {next.length ? next.map(stage) : <Text style={ui.body}>{t('journeyUi.noNext')}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={ui.link}>{t('awardUi.all',{count:stages.length})} {expanded ? '−' : '+'}</Text>
    </Pressable>
    {expanded && GROWTH_FAMILIES.map(family => <View key={family} style={{ gap: 12 }}>
      <Text style={ui.section}>{t('journeyUi.' + family)}</Text>
      <Text style={ui.secondary}>{t('journeyUi.' + family + 'Rule')}</Text>
      {family === 'feedback' && <Text style={ui.secondary}>{t('journeyUi.optional')}</Text>}
      {stages.filter(s => s.family === family).map(stage)}
      {family === 'competency' && metrics.competenciesTotal === 0 && <Text style={ui.body}>{t('growthUi.noCompetencies')}</Text>}
    </View>)}</>}
  </View>;
}
