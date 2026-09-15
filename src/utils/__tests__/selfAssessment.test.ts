import { gapTag, levelLabel, selfVsMentorCsvRows } from '@/utils/selfAssessment';

const t = (k: string, d?: string) => d ?? k;

test('levelLabel names the four steps and nothing else', () => {
  expect([0, 1, 2, 3].map((l) => levelLabel(l as 0 | 1 | 2 | 3, t)))
    .toEqual(['Observed', 'Heavy support', 'Partial support', 'Independent']);
});

test('gapTag flags a full point either way and stays quiet in between', () => {
  expect(gapTag(1)).toBe('low');
  expect(gapTag(-1)).toBe('high');
  expect(gapTag(0.9)).toBeNull();
  expect(gapTag(-0.9)).toBeNull();
  expect(gapTag(0)).toBeNull();
});

test('csv rows are one per competency in code order with the three numbers', () => {
  const rows = selfVsMentorCsvRows([
    { competencyId: 'b', code: 'C2', name: 'Two', tasks: 3, avgSelf: 2.3, avgMentor: 1.7, gap: -0.6, overRated: 2, underRated: 0 },
    { competencyId: 'a', code: 'C1', name: 'One', tasks: 1, avgSelf: 1, avgMentor: 3, gap: 2, overRated: 0, underRated: 1 },
  ]);
  expect(rows).toEqual([['One', 1, 1, 3, 2], ['Two', 3, 2.3, 1.7, -0.6]]);
});
