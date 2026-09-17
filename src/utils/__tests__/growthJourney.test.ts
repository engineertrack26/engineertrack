import { growthStages, nextGrowthStages } from '../growthJourney';
import type { GrowthJourneyMetrics } from '@/types/growthJourney';
import { readFileSync } from 'node:fs';
const base: GrowthJourneyMetrics = { groupId: 'g', approvedTasks: 0, availableTasks: 30, improvedTasks: 0,
  reflectiveDays: 0, activeWeeks: 0, competenciesReached: 0, competenciesTotal: 6,
  plannedWeeks: 52, plannedDays: 365, prepared: true, closed: false };
test('long placements have six families and 22 distinct meaningful stages', () => {
  const stages = growthStages(base);
  expect(new Set(stages.map(s => s.family)).size).toBe(6);
  expect(stages).toHaveLength(22);
  expect(new Set(stages.map(s => s.id)).size).toBe(stages.length);
});
test('short placements and low task counts do not recommend unreachable tiers', () => {
  const stages = growthStages({ ...base, plannedWeeks: 6, plannedDays: 30, availableTasks: 2 });
  expect(stages.find(s => s.id === 'production_5')?.available).toBe(false);
  expect(stages.find(s => s.id === 'consistency_8')?.available).toBe(false);
  expect(stages.find(s => s.id === 'reflection_50')?.available).toBe(false);
  expect(nextGrowthStages(stages).every(s => s.available && !s.optional && !s.complete)).toBe(true);
});
test('next goals are at most three, from different families, and exclude feedback', () => {
  const goals = nextGrowthStages(growthStages({ ...base, approvedTasks: 4, reflectiveDays: 4, activeWeeks: 3 }));
  expect(goals).toHaveLength(3);
  expect(new Set(goals.map(s => s.family)).size).toBe(3);
  expect(goals.map(s => s.family)).not.toContain('feedback');
});
test('small target sets collapse duplicate tiers; no targets never means complete', () => {
  expect(growthStages({ ...base, competenciesTotal: 1 }).filter(s => s.family === 'competency')).toHaveLength(1);
  expect(growthStages({ ...base, competenciesTotal: 0 }).filter(s => s.family === 'competency')).toEqual([]);
  expect(growthStages({ ...base, groupId: null })).toEqual([]);
});
test('reopened closure and withdrawn approvals reflect current verified status', () => {
  const withoutClosure = growthStages({ ...base, closed: null });
  expect(withoutClosure.find(s => s.id === 'journey_closed')).toMatchObject({ available: false, complete: false });
  expect(nextGrowthStages(withoutClosure).some(s => s.id === 'journey_closed')).toBe(false);
  expect(nextGrowthStages(growthStages({ ...base, closed: true }))).toEqual([]);
  expect(growthStages({ ...base, closed: true }).find(s => s.id === 'journey_closed')?.complete).toBe(true);
  expect(growthStages(base).find(s => s.id === 'journey_closed')?.complete).toBe(false);
  expect(growthStages({ ...base, approvedTasks: 5 }).find(s => s.id === 'production_5')?.complete).toBe(true);
  expect(growthStages({ ...base, approvedTasks: 4 }).find(s => s.id === 'production_5')?.complete).toBe(false);
});
test.each(['en','tr','de','it','ro','sr','el'])('%s provides every journey label with correct placeholders', lang => {
  const en = JSON.parse(readFileSync('src/i18n/locales/en.json','utf8')).journeyUi;
  const locale = JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`,'utf8')).journeyUi;
  expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(locale[key].trim()).not.toBe('');
    expect((locale[key].match(/\{\{\w+\}\}/g)||[]).sort()).toEqual((en[key].match(/\{\{\w+\}\}/g)||[]).sort());
  }
});
test.each(['en','tr','de','it','ro','sr','el'])('%s provides persistent award labels', lang => {
  const en = JSON.parse(readFileSync('src/i18n/locales/en.json','utf8')).awardUi;
  const locale = JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`,'utf8')).awardUi;
  expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort());
  for(const key of Object.keys(en)) {
    expect(locale[key].trim()).not.toBe('');
    expect((locale[key].match(/\{\{\w+\}\}/g)||[]).sort()).toEqual((en[key].match(/\{\{\w+\}\}/g)||[]).sort());
  }
});
