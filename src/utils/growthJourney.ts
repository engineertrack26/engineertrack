import type { GrowthFamily, GrowthJourneyMetrics, GrowthStage } from '@/types/growthJourney';

export const GROWTH_FAMILIES: GrowthFamily[] = ['production', 'reflection', 'competency', 'consistency', 'feedback', 'journey'];
export function growthStages(metrics: GrowthJourneyMetrics): GrowthStage[] {
  if (!metrics.groupId) return [];
  const stages: GrowthStage[] = [];
  const add = (family: GrowthFamily, targets: number[], current: number, capacity: number, optional = false) => {
    for (const target of [...new Set(targets)].filter(n => n > 0)) stages.push({
      id: `${family}_${target}`, family, target, current,
      complete: current >= target, available: current >= target || capacity >= target, optional,
    });
  };
  add('production', [1, 5, 15, 30], metrics.approvedTasks, metrics.availableTasks);
  add('feedback', [1, 3, 5], metrics.improvedTasks, metrics.availableTasks, true);
  add('reflection', [5, 20, 50, 100], metrics.reflectiveDays, metrics.plannedDays);
  add('consistency', [4, 8, 16, 24], metrics.activeWeeks, metrics.plannedWeeks);
  const total = metrics.competenciesTotal;
  add('competency', total ? [1, Math.ceil(total * .25), Math.ceil(total * .5), total] : [], metrics.competenciesReached, total);
  for (const [label, complete] of [
    ['prepared', metrics.prepared], ['reviewed', metrics.approvedTasks > 0], ['closed', metrics.closed === true],
  ] as const) stages.push({ id: `journey_${label}`, family: 'journey', target: 1, current: complete ? 1 : 0, complete,
    available: label !== 'closed' || metrics.closed !== null, optional: false, label });
  return stages;
}

// One next goal per family, excluding optional revision goals and inaccessible
// tiers. Nearer goals lead; no opaque global completion percentage.
export function nextGrowthStages(stages: GrowthStage[]): GrowthStage[] {
  if (stages.some(s => s.id === 'journey_closed' && s.complete)) return [];
  return GROWTH_FAMILIES.map(family => stages.find(s => s.family === family && !s.complete && s.available && !s.optional))
    .filter((s): s is GrowthStage => !!s)
    .sort((a, b) => b.current / b.target - a.current / a.target)
    .slice(0, 3);
}
