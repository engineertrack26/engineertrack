import { gapTag, levelLabel, selfVsMentorCsvRows, weightedGap } from '@/utils/selfAssessment';

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

test('weightedGap weights by tasks', () => {
  expect(weightedGap([{ gap: 1, tasks: 1 }, { gap: -1, tasks: 3 }])).toBe(-0.5);
});

test('CSV localizes catalog competencies only in Turkish without changing ratings or source rows', () => {
  const rows = [
    { competencyId: 'a', code: 'C1', name: 'Technical Documentation', tasks: 3, avgSelf: 2.3, avgMentor: 1.7, gap: -0.6, overRated: 2, underRated: 0 },
    { competencyId: 'b', code: 'C2', name: 'Custom competency', tasks: 1, avgSelf: 1, avgMentor: 3, gap: 2, overRated: 0, underRated: 1 },
  ];
  const before = JSON.stringify(rows);
  expect(selfVsMentorCsvRows(rows, 'tr-TR')).toEqual([
    ['Teknik Dokümantasyon', 3, 2.3, 1.7, -0.6], ['Custom competency', 1, 1, 3, 2],
  ]);
  expect(selfVsMentorCsvRows(rows, 'de')).toEqual(selfVsMentorCsvRows(rows));
  expect(JSON.stringify(rows)).toBe(before);
});

test('weightedGap is null with no rows', () => {
  expect(weightedGap([])).toBeNull();
});

test('weightedGap of a single row is its own gap', () => {
  expect(weightedGap([{ gap: 0.6, tasks: 2 }])).toBe(0.6);
});
