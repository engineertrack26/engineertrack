import type { AttendanceDayRow, AttendanceStudentRow, StudentReportRow } from '@/types/report';

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

/** Attendance totals, one row per student, in the CSV's column order. Students
 *  are sorted by name so two exports of the same group line up in a diff. */
export function attendanceSummaryRows(students: AttendanceStudentRow[], locale: string): Array<Array<string | number>> {
  return [...students].sort((a, b) => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id)).map((s) =>
    [s.name, s.company, s.mentor, s.expectedSoFar, s.expectedDays, s.unrecorded, s.present, s.partial, s.excused, s.absent, s.pending, s.corrections, s.submittedLogs]);
}

/** One CSV row per internship day: who, when, what the mentor decided and
 *  when, whether the student checked in on the day itself, and whether a log
 *  was submitted. The record a university auditor asks for. Ordered by
 *  student then date. Timestamps stay ISO -- a spreadsheet parses them and an
 *  auditor can read them; a localised string would do neither reliably. */
export function attendanceDayRows(days: AttendanceDayRow[], locale: string, labels: {
  yes: string; no: string; attendance: (value: AttendanceDayRow['attendance']) => string; logStatus: (value: AttendanceDayRow['logStatus']) => string;
}): Array<Array<string | number>> {
  return [...days].sort((a, b) => a.name.localeCompare(b.name, locale) || a.studentId.localeCompare(b.studentId) || a.date.localeCompare(b.date))
    .map((d) => [d.name, d.date, labels.attendance(d.attendance), d.checkedIn ? labels.yes : labels.no, d.checkInAt || '',
      d.decidedBy, d.decidedAt || '', d.correctionRequested ? labels.yes : labels.no, labels.logStatus(d.logStatus)]);
}
