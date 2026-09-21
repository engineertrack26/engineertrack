import { readInternshipForm, validateInternshipForm, internshipPayload, parseInternshipDate,
  internshipDateString, sameInternshipForm, internshipReturnPath, requiredInternshipFields } from '../internshipForm';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

const valid = () => readInternshipForm({ university: 'University', department: 'Engineering', student_id: '0012-A',
  company_name: 'Company', internship_start_date: '2026-09-01', internship_end_date: '2026-09-30' });

test('keeps exactly the existing six required fields', () => {
  expect(Object.keys(validateInternshipForm(readInternshipForm(null))).sort()).toEqual([...requiredInternshipFields].sort());
  expect(validateInternshipForm(valid())).toEqual({});
});

test('optional empty fields become null, whitespace is trimmed, and student number remains text', () => {
  const form = { ...valid(), company_name: ' Company ', faculty: ' ', company_address: 'Street\nBuilding' };
  expect(internshipPayload(form)).toMatchObject({ company_name: 'Company', faculty: null, student_id: '0012-A',
    company_address: 'Street\nBuilding', department_branch: null, company_sector: null });
  expect(Object.keys(internshipPayload(form))).toHaveLength(10);
});

test('rejects rolled dates and invalid leap days, and accepts valid leap days', () => {
  expect(parseInternshipDate('2026-02-30')).toBeNull();
  expect(parseInternshipDate('2026-02-29')).toBeNull();
  expect(parseInternshipDate('2028-02-29')).not.toBeNull();
  expect(parseInternshipDate('2026-13-01')).toBeNull();
  expect(parseInternshipDate('01/09/2026')).toBeNull();
});

test('local date round-trip does not shift a day', () => {
  expect(internshipDateString(new Date(2026, 8, 13, 0, 0))).toBe('2026-09-13');
  const parsed = parseInternshipDate('2026-09-13')!;
  expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours()]).toEqual([2026, 8, 13, 0]);
});

test('end before start is rejected; same-day internship remains allowed', () => {
  expect(validateInternshipForm({ ...valid(), internship_end_date: '2026-08-31' }).internship_end_date).toBe('order');
  expect(validateInternshipForm({ ...valid(), internship_end_date: '2026-09-01' })).toEqual({});
  expect(validateInternshipForm({ ...valid(), internship_end_date: 'invalid' }).internship_end_date).toBe('date');
});

test('detects unsaved changes without treating a new object as an edit', () => {
  expect(sameInternshipForm(valid(), { ...valid() })).toBe(true);
  expect(sameInternshipForm(valid(), { ...valid(), faculty: 'New' })).toBe(false);
});

test('loads only known fields and tolerates absent optional values', () => {
  const form = readInternshipForm({ ...valid(), faculty: null, company_address: 123, total_xp: 900 });
  expect(form.faculty).toBe('');
  expect(form.company_address).toBe('');
  expect(form).not.toHaveProperty('total_xp');
});

test('return routes are limited to the two existing entry points', () => {
  expect(internshipReturnPath('dashboard')).toBe('/(student)/dashboard');
  expect(internshipReturnPath('profile')).toBe('/(student)/profile');
  expect(internshipReturnPath('../(advisor)/groups')).toBe('/(student)/profile');
  expect(internshipReturnPath()).toBe('/(student)/profile');
});

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s provides internship form labels and interpolations', (_language, locale) => {
  expect(Object.keys(locale.internshipUi).sort()).toEqual(Object.keys(en.internshipUi).sort());
  for (const key of Object.keys(en.internshipUi) as (keyof typeof en.internshipUi)[]) {
    expect(locale.internshipUi[key].trim()).not.toBe('');
    expect((locale.internshipUi[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.internshipUi[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});
