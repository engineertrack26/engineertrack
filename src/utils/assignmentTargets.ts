import type { AssignmentCounts } from '@/types/assignment';

export interface StudentLevel {
  studentId: string;
  currentLevel: number;
}

/** Highest level first: the picker exists to answer "who is ready". A stable
 *  sort, so students on the same level keep the order the caller gave them
 *  (alphabetical, from the member list). `null` levels means the read failed
 *  or the batch spans two competencies -- the list still has to render. */
export function sortByLevel<T extends { id: string }>(
  students: T[],
  levels: StudentLevel[] | null,
): T[] {
  if (!levels) return students;
  const byId = new Map(levels.map((l) => [l.studentId, l.currentLevel]));
  return students
    .map((s, index) => ({ s, index, level: byId.get(s.id) ?? 0 }))
    .sort((a, b) => b.level - a.level || a.index - b.index)
    .map((x) => x.s);
}

/** "2 / 3". The denominator is the number of people who were actually given
 *  the task, which after targeting is no longer the member count. */
export function submittedOfTarget(counts: AssignmentCounts): string {
  if (!counts.targetCount) return String(counts.submitted);
  return `${counts.submitted} / ${counts.targetCount}`;
}

/** The one competency a batch is drawn from, or null when it spans more than
 *  one (or any task's competency is unresolved). Null means the picker shows
 *  no level badges: a level from the wrong competency is worse than none. */
export function soleCompetencyId(ids: (string | undefined)[]): string | null {
  if (!ids.length || ids.some((id) => !id)) return null;
  const first = ids[0] as string;
  return ids.every((id) => id === first) ? first : null;
}
