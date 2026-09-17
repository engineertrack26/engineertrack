import { supabase } from './supabase';
import type { GrowthJourneyMetrics, GrowthJourneyData, GrowthAward } from '@/types/growthJourney';

export function parseGrowthJourney(value: unknown): GrowthJourneyMetrics {
  if (!value || typeof value !== 'object') throw new Error('Invalid growth response');
  const data = value as Record<string, unknown>;
  if (data.groupId === null) return { groupId: null, approvedTasks: 0, availableTasks: 0, improvedTasks: 0,
    reflectiveDays: 0, activeWeeks: 0, competenciesReached: 0, competenciesTotal: 0,
    plannedDays: 0, plannedWeeks: 0, prepared: false, closed: false };
  if (typeof data.groupId !== 'string' || !data.groupId) throw new Error('Invalid group');
  for (const key of ['approvedTasks','availableTasks','improvedTasks','reflectiveDays','activeWeeks',
    'competenciesReached','competenciesTotal','plannedDays','plannedWeeks']) {
    if (!Number.isSafeInteger(data[key]) || Number(data[key]) < 0) throw new Error('Invalid growth metric');
  }
  if (typeof data.prepared !== 'boolean' || (data.closed !== null && typeof data.closed !== 'boolean')) throw new Error('Invalid growth status');
  return data as unknown as GrowthJourneyMetrics;
}
export function parseGrowthAwards(value: unknown): GrowthJourneyData {
  const payload = value as {metrics?: unknown; awards?: unknown} | null;
  if (!payload || !Array.isArray(payload.awards)) throw new Error('Invalid award response');
  const metrics = parseGrowthJourney(payload.metrics);
  const awards = payload.awards.map((a: GrowthAward) => {
    if (!a || typeof a.groupId !== 'string' || typeof a.stageId !== 'string'
      || !['production','feedback','reflection','competency','consistency','journey'].includes(a.family)
      || !Number.isSafeInteger(a.target) || a.target<1 || a.ruleVersion!==1
      || typeof a.verified!=='boolean' || !Number.isFinite(Date.parse(a.earnedAt))
      || !Number.isFinite(Date.parse(a.checkedAt))
      || ![null,'prepared','reviewed','closed'].includes(a.label)) throw new Error('Invalid award');
    return a;
  });
  return {...metrics,awards};
}
export async function getGrowthJourney(): Promise<GrowthJourneyData> {
  const { data, error } = await supabase.rpc('sync_my_growth_awards');
  if (error) throw error;
  return parseGrowthAwards(data);
}
