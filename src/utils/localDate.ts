/**
 * Calendar dates as `YYYY-MM-DD`, in LOCAL time on purpose. `toISOString()`
 * converts local midnight to UTC, which in any positive offset lands on the
 * previous day, and `new Date('2026-09-01')` is parsed as UTC and then
 * rendered locally, which does the same thing in reverse. Either one silently
 * shifts a due date or an internship date by a day. Every screen with a date
 * picker goes through these two.
 */
export function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Strict: `2026-02-31` is null, not March 3rd. */
export function fromLocalIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}
