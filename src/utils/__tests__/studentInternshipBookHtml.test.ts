import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import type { StudentInternshipBook } from '@/services/studentInternshipBook';
import { studentInternshipBookHtml } from '../studentInternshipBookHtml';

const book: StudentInternshipBook = {
  student: { id: 'student-1', name: 'İpek <Yılmaz>', studentNumber: '123', university: 'Üniversite',
    department: 'Mühendislik', company: 'Atölye', startDate: '2026-01-01', endDate: '2026-12-31' },
  groups: [{ id: 'g', name: 'Staj', term: 'Güz', joinedAt: '2026-01-01', leftAt: null, advisor: 'Ayşe' }],
  placements: [{ id: 'p', groupId: 'g', company: 'Atölye', mentor: 'Hasan', startDate: '2026-01-01', endDate: '2026-12-31' }],
  competencies: [{ groupId: 'g', groupName: 'Staj', name: 'Technical Documentation', targetLevel: 3, reachedLevel: 2 }],
  tasks: [{ id: 't', groupId: 'g', groupName: 'Staj', title: 'Task <script>alert(1)</script>', objective: 'Objective',
    criterion: 'Criterion', description: null, status: 'approved', submittedAt: '2026-09-10', reviewedAt: '2026-09-11',
    studentNote: null, reflection: 'Satır 1\nSatır 2', reviewerNote: 'İyi', reviewedBy: 'Ayşe', selfLevel: 0, reviewerLevel: 3 }],
  days: [
    { id: 'late', date: '2026-09-12', company: 'Atölye', attendance: 'present', checkInAt: '2026-09-12T08:00:00Z',
      decidedAt: '2026-09-12T17:00:00Z', decidedBy: 'Hasan', attendanceNote: '', correctionRequested: false,
      logStatus: 'submitted', submittedAt: '2026-09-12T18:00:00Z', taskTitle: 'Task', competencyName: null,
      experience: 'Motor <kontrol>', learning: 'Yeni öğrendim', nextStep: 'Tekrar', supportLevel: 0, attachmentName: 'kanıt.pdf' },
    { id: 'early', date: '2026-09-11', company: 'Atölye', attendance: 'pending', checkInAt: null,
      decidedAt: null, decidedBy: '', attendanceNote: '', correctionRequested: false, logStatus: 'draft',
      submittedAt: null, taskTitle: 'PRIVATE', competencyName: null, experience: 'TASLAK GİZLİ',
      learning: 'TASLAK ÖĞRENME', nextStep: null, supportLevel: null, attachmentName: null },
  ],
};
const label = (locale: Record<string, unknown>) => (key: string) =>
  key.split('.').reduce<any>((value, part) => value?.[part], locale);

test('Turkish personal book is chronological, escapes content, and excludes draft journal text', () => {
  const html = studentInternshipBookHtml(book, 'tr', label(tr), new Date('2026-09-20T12:00:00Z'));
  expect(html).toContain('Staj defterim');
  expect(html).toContain('Teknik Dokümantasyon');
  expect(html).toContain('İpek &lt;Yılmaz&gt;');
  expect(html).toContain('Task &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('TASLAK GİZLİ');
  expect(html).not.toContain('TASLAK ÖĞRENME');
  expect(html).toContain('Motor &lt;kontrol&gt;');
  expect(html).toContain('kanıt.pdf');
  expect(html.indexOf('11.09.2026')).toBeLessThan(html.indexOf('12.09.2026'));
  expect(html).not.toContain('undefined');
  expect(html).not.toContain('NaN');
});

test('English PDF labels exist and input snapshot is not changed', () => {
  const before = JSON.stringify(book);
  const html = studentInternshipBookHtml(book, 'en', label(en), new Date('2026-09-20T12:00:00Z'));
  expect(html).toContain('My internship book');
  expect(html).toContain('Daily internship record');
  expect(JSON.stringify(book)).toBe(before);
  expect(Object.keys(tr.studentBook).sort()).toEqual(Object.keys(en.studentBook).sort());
});
