import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import type { GroupExport } from '@/services/advisorGroupExport';
import { groupExportCsv } from '../groupExportCsv';

const sample: GroupExport = {
  groupId: 'group-1', groupName: '2026, Staj', term: 'Güz', archived: true,
  students: [{ studentId: 'student-1', name: 'İpek Yılmaz', joinedAt: '2026-01-01', leftAt: '2026-06-01' }],
  competencies: [{ studentId: 'student-1', name: 'Technical Documentation', targetLevel: 3, reachedLevel: 2 }],
  tasks: [{ taskId: 'task-1', title: 'Custom task', objective: 'Custom objective', criterion: 'Custom criterion',
    description: null, dueDate: null, publishedAt: '2026-01-02' }],
  submissions: [{ taskId: 'task-1', studentId: 'student-1', status: 'approved', submittedAt: '2026-01-04',
    reviewedAt: '2026-01-05', studentNote: '=1+1', reflection: 'İlk satır\nİkinci satır, "alıntı"',
    reviewerNote: null, selfLevel: 0, reviewerLevel: 3 }],
  attendanceTotals: [{ id: 'student-1', name: 'İpek Yılmaz', company: 'Atölye', mentor: 'Hasan',
    expectedDays: 100, expectedSoFar: 100, recorded: 90, unrecorded: 10, present: 80,
    partial: 5, excused: 2, absent: 3, pending: 0, corrections: 1, submittedLogs: 85 }],
  days: [{ studentId: 'student-1', date: '2026-01-04', company: 'Atölye', attendance: 'present',
    checkInAt: '2026-01-04T08:00:00Z', decidedAt: '2026-01-04T18:00:00Z', attendanceNote: '',
    correctionRequested: false, logStatus: 'submitted', taskTitle: null, experience: 'Çalıştım',
    learning: 'Öğrendim', nextStep: 'Tekrar deneyeceğim', supportLevel: 0 }],
};

test('archived group CSV includes former student, task result, attendance and submitted journal text', () => {
  const csv = groupExportCsv(sample, 'tr', (key) => key.split('.').reduce<any>((v, k) => v[k], tr));
  expect(csv.startsWith('\ufeff')).toBe(true);
  for (const value of ['İpek Yılmaz', '2026-06-01', 'YETKİNLİK DÜZEYLERİ', 'Teknik Dokümantasyon', 'GÖREV SONUÇLARI', 'Onaylandı',
    'DEVAM ÖZETİ', 'STAJ GÜNLERİ VE GÜNLÜKLER', 'Çalıştım', 'Öğrendim', 'Tekrar deneyeceğim']) {
    expect(csv).toContain(value);
  }
  expect(csv).toContain('"İlk satır\nİkinci satır, ""alıntı"""');
  expect(csv).toContain("'=1+1");
  expect(csv).toContain('İpek Yılmaz');
  expect(csv).toContain(',0,3');
  expect(csv).not.toContain('undefined');
});

test('CSV uses English labels for English language and does not mutate the snapshot', () => {
  const before = JSON.stringify(sample);
  const csv = groupExportCsv(sample, 'en', (key) => key.split('.').reduce<any>((v, k) => v[k], en));
  expect(csv).toContain('TASK RESULTS');
  expect(csv).toContain('Journals submitted');
  expect(JSON.stringify(sample)).toBe(before);
});

test('export label sets remain in sync', () => {
  expect(Object.keys(tr.advisorExport).sort()).toEqual(Object.keys(en.advisorExport).sort());
});
