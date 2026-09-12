export interface UpcomingCandidate {
  id: string;
  title: string;
  /** Bare YYYY-MM-DD from group_assignments.due_date, or undefined. */
  dueDate?: string;
}

export const UPCOMING_WINDOW_DAYS = 14;
export const UPCOMING_MAX = 3;

/** Local-midnight parse of a bare YYYY-MM-DD; undefined for anything else.
 *  `new Date('2026-09-11')` would be UTC midnight and read as the 10th west
 *  of UTC — the same trap taskDueDate in studentTasks.ts avoids. */
function parseDay(value?: string): Date | undefined {
  const m = value && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Tasks due from `today` (local midnight) through today + window, nearest
 *  first, at most `max`. Overdue tasks and tasks with no due date are not
 *  "upcoming" and are left out; ties keep input order. */
export function upcomingTasks<T extends UpcomingCandidate>(
  items: T[],
  today: Date,
  windowDays = UPCOMING_WINDOW_DAYS,
  max = UPCOMING_MAX,
): T[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + windowDays);
  return items
    .map((item, index) => ({ item, index, due: parseDay(item.dueDate) }))
    .filter((x): x is { item: T; index: number; due: Date } => !!x.due && x.due >= start && x.due <= end)
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.index - b.index)
    .slice(0, max)
    .map((x) => x.item);
}
