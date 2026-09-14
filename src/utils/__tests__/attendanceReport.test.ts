import { attendanceDayRows, attendanceSummaryRows } from '../advisorReportView';
import type { AttendanceDayRow, AttendanceStudentRow } from '@/types/report';

const student = (id: string, name: string, extra: Partial<AttendanceStudentRow> = {}): AttendanceStudentRow => ({
  id, name, company: 'Acme', mentor: 'Mert', present: 0, partial: 0, excused: 0, absent: 0, pending: 0, corrections: 0, submittedLogs: 0, ...extra,
});
const day = (studentId: string, name: string, date: string, extra: Partial<AttendanceDayRow> = {}): AttendanceDayRow => ({
  studentId, name, date, attendance: 'pending', checkedIn: false, checkInAt: null, decidedBy: '', decidedAt: null, correctionRequested: false, logStatus: 'draft', ...extra,
});
const labels = { yes: 'Y', no: 'N', attendance: (v: string) => `A:${v}`, logStatus: (v: string) => `L:${v}` };

test('summary rows are sorted by name with the locale and carry every count in column order', () => {
  const rows = attendanceSummaryRows([
    student('2', 'İpek', { present: 4, pending: 1 }),
    student('1', 'Zeynep', { partial: 1, absent: 2, corrections: 1, submittedLogs: 3 }),
    student('3', 'Ali'),
  ], 'tr');
  expect(rows.map((r) => r[0])).toEqual(['Ali', 'İpek', 'Zeynep']);
  expect(rows[2]).toEqual(['Zeynep', 'Acme', 'Mert', 0, 1, 0, 2, 0, 1, 3]);
});

test('day rows are ordered by student then date, and render flags through the labels', () => {
  const rows = attendanceDayRows([
    day('1', 'Zeynep', '2026-09-02', { attendance: 'present', checkedIn: true, checkInAt: '2026-09-02T06:01:00+00:00', decidedBy: 'Mert', decidedAt: '2026-09-05T10:00:00+00:00', logStatus: 'submitted' }),
    day('2', 'Ali', '2026-09-03'),
    day('1', 'Zeynep', '2026-09-01', { correctionRequested: true }),
  ], 'tr', labels);
  expect(rows.map((r) => `${r[0]} ${r[1]}`)).toEqual(['Ali 2026-09-03', 'Zeynep 2026-09-01', 'Zeynep 2026-09-02']);
  expect(rows[2]).toEqual(['Zeynep', '2026-09-02', 'A:present', 'Y', '2026-09-02T06:01:00+00:00', 'Mert', '2026-09-05T10:00:00+00:00', 'N', 'L:submitted']);
  expect(rows[1].slice(2)).toEqual(['A:pending', 'N', '', '', '', 'Y', 'L:draft']);
});
