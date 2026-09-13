import type { StudentReportRow } from '@/types/report';

/** Quote a CSV field rather than stripping its commas: the group and student
 *  names are what an advisor reads to tell two exports apart, so mangling them
 *  defeats the point of naming the group at all. */
function csvCell(value: string | number): string {
  let s = String(value ?? '');
  // Excel and Sheets read a cell opening with =, +, - or @ as a formula, so a
  // student named "-Ali" or a group named "=2026" executes on open. A leading
  // apostrophe is the standard neutraliser and the sheet does not display it.
  // Numbers are exempt: every number here is our own arithmetic, and quoting a
  // negative one would only stop it parsing as a number.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

export function filterReportStudents(rows: StudentReportRow[], query: string, sort: 'name' | 'progress', locale: string): StudentReportRow[] {
  const search = query.trim().toLocaleLowerCase(locale);
  return rows.filter((row) => row.name.toLocaleLowerCase(locale).includes(search)).sort((a, b) =>
    (sort === 'progress' ? a.completionPercent - b.completionPercent : 0) || a.name.localeCompare(b.name, locale));
}
