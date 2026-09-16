import { csvRow, filterReportStudents } from '../advisorReportView';
import type { StudentReportRow } from '@/types/report';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

const rows: StudentReportRow[] = [
  { id: '1', name: 'Zeynep', completionPercent: 70, submitted: 3, approved: 1, selfVsMentor: [], selfVsMentorGap: null },
  { id: '2', name: 'İpek', completionPercent: 20, submitted: 2, approved: 1, selfVsMentor: [], selfVsMentorGap: null },
  { id: '3', name: 'Ali', completionPercent: 20, submitted: 1, approved: 0, selfVsMentor: [], selfVsMentorGap: null },
];

test('student search supports Turkish casing and trimmed input', () => {
  expect(filterReportStudents(rows, ' ipek ', 'name', 'tr').map((r) => r.id)).toEqual(['2']);
  expect(filterReportStudents(rows, 'missing', 'name', 'tr')).toEqual([]);
});

test('sorts progress ascending with names as tie-breakers, without changing the report', () => {
  const before = JSON.stringify(rows);
  expect(filterReportStudents(rows, '', 'progress', 'tr').map((r) => r.id)).toEqual(['3', '2', '1']);
  expect(filterReportStudents(rows, '', 'name', 'tr').map((r) => r.id)).toEqual(['3', '2', '1']);
  expect(JSON.stringify(rows)).toBe(before);
});

test('CSV keeps commas, double quotes and line breaks inside quoted cells', () => {
  expect(csvRow(['Group, A', 'A "quoted" name', 'line\nbreak', 5]))
    .toBe('"Group, A","A ""quoted"" name","line\nbreak",5');
});

test.each(['=SUM(A1)', '+123', '-Ali', '@user', '\tname', '\rname'])('CSV neutralizes formula-like text %p', (value) => {
  const result = csvRow([value]);
  expect(result.startsWith("'") || result.startsWith('"\'')).toBe(true);
});

test('CSV keeps actual numbers numeric and preserves Unicode names', () => {
  expect(csvRow([-5, 12.5, 'İpek Yılmaz'])).toBe('-5,12.5,İpek Yılmaz');
});

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s has complete report labels', (_language, locale) => {
  expect(Object.keys(locale.advisorReports).sort()).toEqual(Object.keys(en.advisorReports).sort());
  for (const value of Object.values(locale.advisorReports)) expect(value.trim()).not.toBe('');
});
