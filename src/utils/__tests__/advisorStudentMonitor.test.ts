import { filterMonitorStudents, mapMonitorStudent } from '../advisorStudentMonitor';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

test('search matches Turkish names, email and company without mutating the source order', () => {
  const rows = [
    { firstName: 'Zeynep', lastName: 'Usta', email: 'test@example.com' },
    { firstName: 'İpek', lastName: 'Yılmaz', companyName: 'Atölye' },
  ];
  expect(filterMonitorStudents(rows, ' ipek ', 'tr')).toEqual([rows[1]]);
  expect(filterMonitorStudents(rows, 'EXAMPLE', 'tr')).toEqual([rows[0]]);
  expect(filterMonitorStudents(rows, 'atölye', 'tr')).toEqual([rows[1]]);
  expect(filterMonitorStudents(rows, 'missing', 'tr')).toEqual([]);
  expect(filterMonitorStudents(rows, '', 'tr')[0]).toBe(rows[1]);
  expect(rows[0].firstName).toBe('Zeynep');
});

test('unavailable progress is not represented as zero attainment', () => {
  expect(mapMonitorStudent({ id: 'a', completionPercent: 0, completionAvailable: false }).completionPct).toBeNull();
  expect(mapMonitorStudent({ id: 'a', completionPercent: 0, completionAvailable: true }).completionPct).toBe(0);
  expect(mapMonitorStudent({ id: 'a', completionPercent: 60, completionAvailable: true }).completionPct).toBe(60);
});

test('missing internship dates stay unknown independently of competency progress', () => {
  expect(mapMonitorStudent({ id: 'a', completionPercent: 80 })).toMatchObject({
    completionPct: 80, daysCurrent: null, daysTotal: null,
  });
});

test('keeps the existing local-calendar day count and its clamping rules', () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 13, 12));
  try {
    const row = { id: 'a', internship_start_date: '2026-09-01', internship_end_date: '2026-09-30' };
    expect(mapMonitorStudent(row)).toMatchObject({ daysCurrent: 13, daysTotal: 29 });
    expect(mapMonitorStudent({ ...row, internship_start_date: '2026-09-20' }).daysCurrent).toBe(0);
    expect(mapMonitorStudent({ ...row, internship_end_date: '2026-09-05' }).daysCurrent).toBe(4);
    expect(mapMonitorStudent({ ...row, internship_end_date: '2026-08-01' }).daysTotal).toBeNull();
  } finally { jest.useRealTimers(); }
});

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s supplies all monitoring labels and placeholders', (_language, locale) => {
  expect(Object.keys(locale.advisorMonitor).sort()).toEqual(Object.keys(en.advisorMonitor).sort());
  for (const key of Object.keys(en.advisorMonitor) as (keyof typeof en.advisorMonitor)[]) {
    expect(locale.advisorMonitor[key].trim()).not.toBe('');
    expect((locale.advisorMonitor[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.advisorMonitor[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});
