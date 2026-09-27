import { sortByLevel, submittedOfTarget, soleCompetencyId } from '@/utils/assignmentTargets';

const students = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bora' },
  { id: 'c', name: 'Cem' },
];

describe('sortByLevel', () => {
  it('puts the highest level first, then falls back to the given order', () => {
    const levels = [
      { studentId: 'a', currentLevel: 1 },
      { studentId: 'b', currentLevel: 3 },
      { studentId: 'c', currentLevel: 3 },
    ];
    expect(sortByLevel(students, levels).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('treats a student the levels do not mention as level 0', () => {
    const levels = [{ studentId: 'c', currentLevel: 2 }];
    expect(sortByLevel(students, levels).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  // The levels never loaded. The picker must still list everybody, in the
  // order it was given -- an empty list would read as "no students".
  it('returns the input unchanged when there are no levels at all', () => {
    expect(sortByLevel(students, null).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('submittedOfTarget', () => {
  it('reads "2 / 3"', () => {
    expect(submittedOfTarget({ assignmentId: 'x', submitted: 2, approved: 1,
      needsRevision: 0, targetCount: 3 })).toBe('2 / 3');
  });

  // targetCount is 0 on a row the server could not count (an assignment whose
  // group has no active members). A denominator of 0 is a lie, not a fact.
  it('omits the denominator when the target count is zero', () => {
    expect(submittedOfTarget({ assignmentId: 'x', submitted: 0, approved: 0,
      needsRevision: 0, targetCount: 0 })).toBe('0');
  });
});

describe('soleCompetencyId', () => {
  it('returns the id when every task shares one competency', () => {
    expect(soleCompetencyId(['k1', 'k1', 'k1'])).toBe('k1');
  });

  // Review Focus 5: a batch spanning two competencies has no single level to
  // show, so the picker must omit the badges rather than pick one.
  it('returns null for a batch that spans two competencies', () => {
    expect(soleCompetencyId(['k1', 'k2'])).toBeNull();
  });

  it('returns null when a task has no competency resolved', () => {
    expect(soleCompetencyId(['k1', undefined])).toBeNull();
    expect(soleCompetencyId([])).toBeNull();
  });
});
