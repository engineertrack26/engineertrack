import { competencyCompletion, averageCompletion } from '@/utils/reportMetrics';

const at = (current: number, target: number) => ({
  competencyId: `c${current}${target}`, code: 'X', name: 'X',
  currentLevel: current, targetLevel: target,
});

describe('competencyCompletion', () => {
  it('counts a competency at its target as complete', () => {
    expect(competencyCompletion([at(2, 2)])).toEqual({ atTarget: 1, targeted: 1, percent: 100 });
  });

  // Overshooting the target is still complete. A student who reached level 3
  // against a target of 2 has not done 150% of the work -- the target is a
  // floor, and percent must never exceed 100.
  it('treats exceeding the target as complete, not as more than complete', () => {
    expect(competencyCompletion([at(3, 2)])).toEqual({ atTarget: 1, targeted: 1, percent: 100 });
  });

  it('counts a competency below its target as incomplete', () => {
    expect(competencyCompletion([at(1, 2)])).toEqual({ atTarget: 0, targeted: 1, percent: 0 });
  });

  it('rounds a partial result', () => {
    expect(competencyCompletion([at(2, 2), at(1, 2), at(1, 2)]).percent).toBe(33);
  });

  // A group with nothing targeted is 0% done, not NaN and not 100%.
  // get_competency_progress returns only competencies that HAVE a target row,
  // so an empty array means the advisor has set no scope at all.
  it('returns zero for a student with no targeted competencies', () => {
    expect(competencyCompletion([])).toEqual({ atTarget: 0, targeted: 0, percent: 0 });
  });
});

describe('averageCompletion', () => {
  it('averages the students', () => {
    expect(averageCompletion([{ percent: 100 }, { percent: 50 }])).toBe(75);
  });

  it('returns zero for an empty group rather than NaN', () => {
    expect(averageCompletion([])).toBe(0);
  });
});
