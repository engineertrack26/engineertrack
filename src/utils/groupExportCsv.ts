import { csvRow } from './advisorReportView';
import { taskContent } from './taskContent';
import { competencyContent } from './competencyContent';
import type { GroupExport } from '@/services/advisorGroupExport';

type Label = (key: string) => string;
const cell = (value: string | number | boolean | null | undefined): string | number =>
  value == null ? '' : typeof value === 'boolean' ? (value ? 1 : 0) : value;

/** A complete, reviewable snapshot. One section per entity; IDs preserve joins. */
export function groupExportCsv(data: GroupExport, language: string, label: Label): string {
  const text = (key: string) => label(`advisorExport.${key}`);
  const rows: (string | number)[][] = [];
  const add = (...values: (string | number | boolean | null | undefined)[]) => rows.push(values.map(cell));
  const section = (name: string, headers: string[]) => { add(); add(text(name)); add(...headers.map(text)); };

  add(text('group'), data.groupName);
  add(text('term'), data.term);
  add(text('archived'), data.archived ? text('yes') : text('no'));
  add(text('exportedAt'), new Date().toISOString());
  add(text('scopeNote'));

  section('students', ['studentId', 'student', 'joinedAt', 'leftAt']);
  for (const s of data.students) add(s.studentId, s.name, s.joinedAt, s.leftAt);

  section('competencies', ['studentId', 'student', 'competency', 'targetLevel', 'reachedLevel']);
  const names = new Map(data.students.map(s => [s.studentId, s.name]));
  for (const c of data.competencies) add(c.studentId, names.get(c.studentId) ?? '',
    competencyContent(c.name, language), c.targetLevel, c.reachedLevel);

  section('tasks', ['taskId', 'title', 'objective', 'criterion', 'description', 'dueDate', 'publishedAt']);
  for (const a of data.tasks) add(a.taskId, taskContent(a.title, language),
    taskContent(a.objective, language, 'objective'), taskContent(a.criterion, language, 'criterion'),
    a.description, a.dueDate, a.publishedAt);

  section('submissions', ['studentId', 'student', 'taskId', 'title', 'status', 'submittedAt',
    'reviewedAt', 'studentNote', 'reflection', 'reviewerNote', 'selfLevel', 'reviewerLevel']);
  const tasks = new Map(data.tasks.map(a => [a.taskId, a.title]));
  for (const s of data.submissions) add(s.studentId, names.get(s.studentId) ?? '', s.taskId,
    taskContent(tasks.get(s.taskId) ?? '', language), text(`status_${s.status}`), s.submittedAt,
    s.reviewedAt, s.studentNote, s.reflection, s.reviewerNote, s.selfLevel, s.reviewerLevel);

  section('attendanceTotals', ['studentId', 'student', 'company', 'mentor', 'expectedDays',
    'expectedSoFar', 'recorded', 'unrecorded', 'attendance_present', 'attendance_partial',
    'attendance_excused', 'attendance_absent', 'attendance_pending', 'corrections', 'submittedLogs']);
  for (const s of data.attendanceTotals) add(s.id, s.name, s.company, s.mentor, s.expectedDays,
    s.expectedSoFar, s.recorded, s.unrecorded, s.present, s.partial, s.excused,
    s.absent, s.pending, s.corrections, s.submittedLogs);

  section('days', ['studentId', 'student', 'date', 'company', 'attendance', 'checkInAt',
    'decidedAt', 'attendanceNote', 'correctionRequested', 'logStatus', 'taskTitle',
    'experience', 'learning', 'nextStep', 'supportLevel']);
  for (const d of data.days) add(d.studentId, names.get(d.studentId) ?? '', d.date, d.company,
    text(`attendance_${d.attendance}`), d.checkInAt, d.decidedAt, d.attendanceNote,
    d.correctionRequested ? text('yes') : text('no'), text(`log_${d.logStatus}`),
    d.taskTitle ? taskContent(d.taskTitle, language) : '', d.experience, d.learning, d.nextStep, d.supportLevel);

  // BOM helps Excel detect UTF-8 Turkish text; CSV escaping guards multiline
  // reflections and leading formula characters in student-authored content.
  return '\ufeff' + rows.map(csvRow).join('\r\n') + '\r\n';
}
