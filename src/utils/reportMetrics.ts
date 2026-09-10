import type { CompetencyProgress } from '@/types/competency';

export interface CompletionMetrics {
  atTarget: number;
  targeted: number;
  percent: number;
}

/**
 * Calculate completion metrics for a list of competencies.
 *
 * Completion is measured as level reached against target. A competency at or
 * above its target level is considered complete. Exceeding a target is still
 * 100% complete (not more), and an empty target list is 0% (not NaN).
 */
export function competencyCompletion(progress: CompetencyProgress[]): CompletionMetrics {
  if (progress.length === 0) {
    return { atTarget: 0, targeted: 0, percent: 0 };
  }

  const atTarget = progress.filter((c) => c.currentLevel >= c.targetLevel).length;
  const percent = Math.round((atTarget / progress.length) * 100);

  return { atTarget, targeted: progress.length, percent };
}

/**
 * Calculate the average completion percentage across a group of students.
 *
 * Returns 0 for an empty group (not NaN).
 */
export function averageCompletion(students: Array<{ percent: number }>): number {
  if (students.length === 0) {
    return 0;
  }

  const sum = students.reduce((acc, student) => acc + student.percent, 0);
  return Math.round(sum / students.length);
}
