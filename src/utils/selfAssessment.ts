import type { TFunction } from 'i18next';
import { competencyContent } from './competencyContent';

/** The four-step supervision scale used across the internship journal: a task
 *  is one KPI, so a per-task rating is a per-KPI rating. See
 *  docs/superpowers/specs/2026-09-15-self-assessment-design.md decision 1. */
export type SupervisionLevel = 0 | 1 | 2 | 3;
export const SUPERVISION_LEVELS: SupervisionLevel[] = [0, 1, 2, 3];

export function levelLabel(
  level: SupervisionLevel,
  t: TFunction | ((k: string, d?: string) => string),
): string {
  const defaults = ['Observed', 'Heavy support', 'Partial support', 'Independent'];
  return (t as (k: string, d?: string) => string)(`assessment.level_${level}`, defaults[level]);
}

/** One competency's tally from competency_self_vs_mentor -- see decision 4 in
 *  the design. gap = avgMentor - avgSelf. */
export interface SelfVsMentorRow {
  competencyId: string;
  code: string;
  name: string;
  tasks: number;
  avgSelf: number;
  avgMentor: number;
  gap: number;
  overRated: number;
  underRated: number;
}

/** |gap| >= 1 is a full step on a four-step scale: worth a word. gap = mentor - self. */
export function gapTag(gap: number): 'high' | 'low' | null {
  if (gap >= 1) return 'low';
  if (gap <= -1) return 'high';
  return null;
}

export function selfVsMentorCsvRows(rows: SelfVsMentorRow[], language = 'en'): (string | number)[][] {
  return [...rows]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r) => [competencyContent(r.name, language), r.tasks, r.avgSelf, r.avgMentor, r.gap]);
}

/** Weighted mean of `gap` weighted by `tasks`, one decimal. Null when there
 *  are no rows -- distinct from a genuine 0, which a report should still
 *  show. See decision 4 in the design. */
export function weightedGap(rows: { gap: number; tasks: number }[]): number | null {
  const totalTasks = rows.reduce((sum, r) => sum + r.tasks, 0);
  if (totalTasks === 0) return null;
  const weighted = rows.reduce((sum, r) => sum + r.gap * r.tasks, 0);
  return Math.round((weighted / totalTasks) * 10) / 10;
}

/** Weighted mean of `avgSelf` or `avgMentor` across rows, weighted by
 *  `tasks`, one decimal. Null when there are no rows. */
export function weightedAverage(rows: SelfVsMentorRow[], key: 'avgSelf' | 'avgMentor'): number | null {
  return weightedGap(rows.map((r) => ({ gap: r[key], tasks: r.tasks })));
}
