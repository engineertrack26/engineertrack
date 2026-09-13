export interface StudentMonitorItem {
  id: string;
  firstName: string;
  lastName: string;
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
  companyName?: string;
  internshipStartDate?: string;
  internshipEndDate?: string;
  completionPct: number | null;
  /** Both `null` together when the internship span is unknown: a missing or
   *  unusable date is not day zero, so the counter is not rendered at all. */
  daysCurrent: number | null;
  daysTotal: number | null;
}

/** A `YYYY-MM-DD` date at the device's local midnight. `Date.parse` on the bare
 *  string would give UTC midnight, which is a different calendar day for part
 *  of every day anywhere but UTC. NaN for anything that is not a plain date. */
function localMidnight(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return Number.NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function mapMonitorStudent(row: Record<string, unknown>): StudentMonitorItem {
  const profile = row.profiles as Record<string, unknown> | null;
  // Competency attainment, straight off the service row -- the same number
  // the advisor's dashboard and reports screen quote for this student. It was
  // recomputed here from `submitted_days`, which getDashboardStats stopped
  // returning when the daily log was retired; the Record<string, unknown>
  // cast hid that from tsc, so this silently read 0 for everyone.
  const completionPct = row.completionAvailable === false ? null : (row.completionPercent as number) || 0;
  const start = row.internship_start_date as string | null;
  const end = row.internship_end_date as string | null;
  // Elapsed calendar days of the internship, which is what "Day 12 of 60"
  // has always claimed to mean. It used to be driven by `submitted_days`, so
  // it was really an attendance count wearing a calendar's label, and once
  // that field went it read "Day 0" for everyone -- including a student two
  // months in. Nothing here is submission-derived; both dates come off the
  // row `getAssignedStudents` already selects.
  const msPerDay = 1000 * 60 * 60 * 24;
  let daysCurrent: number | null = null;
  let daysTotal: number | null = null;
  if (start && end) {
    // Both columns are Postgres `date`s. `new Date('2026-09-11')` would anchor
    // them at UTC midnight while `Date.now()` is the device's absolute instant,
    // which puts the counter a day out for part of every local day on any
    // device not on UTC. Work in local calendar days instead: each date at the
    // device's local midnight, today at the device's local midnight, and the
    // difference rounded (not floored) so a DST hour cannot shave a day off.
    const startDate = localMidnight(start);
    const endDate = localMidnight(end);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const span = Math.round((endDate - startDate) / msPerDay);
    // An unparseable date gives NaN, and an end on or before the start gives
    // a span of zero or less. Neither is a span we can honestly count within,
    // so both leave the counter unrendered rather than showing "Day 0/0".
    if (Number.isFinite(span) && span > 0) {
      daysTotal = span;
      // Day one is the start date itself, so +1. Clamped at both ends: an
      // internship that has not started yet is day 0 rather than a negative
      // number, and one that has run past its end date reads "Day 60/60"
      // rather than "Day 71/60".
      const elapsed = Math.round((today.getTime() - startDate) / msPerDay) + 1;
      daysCurrent = Math.max(0, Math.min(span, elapsed));
    }
  }
  return {
    id: row.id as string,
    firstName: (profile?.first_name as string) || '',
    lastName: (profile?.last_name as string) || '',
    totalXp: (row.total_xp as number) || 0,
    currentLevel: (row.current_level as number) || 1,
    currentStreak: (row.current_streak as number) || 0,
    companyName: (row.company_name as string) || undefined,
    internshipStartDate: start || undefined,
    internshipEndDate: end || undefined,
    completionPct,
    daysCurrent,
    daysTotal,
  };
}

export function filterMonitorStudents<T extends { firstName: string; lastName: string; email?: string; companyName?: string }>(rows: T[], query: string, locale: string): T[] {
  const search = query.trim().toLocaleLowerCase(locale);
  return rows.filter((row) => [row.firstName + ' ' + row.lastName, row.email, row.companyName]
    .some((value) => value?.toLocaleLowerCase(locale).includes(search)))
    .sort((a, b) => (a.firstName + ' ' + a.lastName).localeCompare(b.firstName + ' ' + b.lastName, locale));
}
