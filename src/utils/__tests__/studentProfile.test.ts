import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERNSHIP_FIELDS, internshipInfoComplete, profileField } from '../studentProfile';

describe('student profile presentation', () => {
  it('retains every existing school and internship field', () => {
    expect(INTERNSHIP_FIELDS.map(([key]) => key)).toEqual(['university', 'faculty', 'department', 'department_branch',
      'student_id', 'company_name', 'company_address', 'company_sector', 'internship_start_date', 'internship_end_date']);
  });
  it('keeps the existing required-field check and does not require optional fields', () => {
    expect(internshipInfoComplete(null)).toBe(false);
    const profile = { university: 'U', department: 'D', company_name: 'C', student_id: '123',
      internship_start_date: '2026-09-01', internship_end_date: '2026-09-30' };
    expect(internshipInfoComplete(profile)).toBe(true);
    expect(internshipInfoComplete({ ...profile, department: '  ' })).toBe(false);
  });
  it('preserves full text, formats dates locally and never invents missing values', () => {
    expect(profileField('Full long company address', false, 'tr')).toBe('Full long company address');
    expect(profileField(null, false, 'tr')).toBe('—');
    expect(profileField('2026-02-30', true, 'tr')).toBe('—');
    expect(profileField('invalid', true, 'tr')).toBe('—');
    expect(profileField('2026-09-01', true, 'en')).toBe('Sep 1, 2026');
  });
});

const languages = ['en', 'tr', 'de', 'it', 'ro', 'sr', 'el'];
const resources = Object.fromEntries(languages.map(language => [language,
  JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/locales', language + '.json'), 'utf8'))]));
const paths = ['src/components/student/StudentProfileSections.tsx', 'app/(student)/profile.tsx', 'src/utils/studentProfile.ts'];
const keys = [...new Set(paths.flatMap(path => [...readFileSync(join(process.cwd(), path), 'utf8')
  .matchAll(/['"]((?:studentProfileView|common|student)\.[A-Za-z]+)['"]/g)].map(match => match[1])))];
it.each(languages)('has student profile strings in %s', language => {
  expect(Object.keys(resources[language].studentProfileView).sort()).toEqual(Object.keys(resources.en.studentProfileView).sort());
  for (const key of keys) {
    const [section, name] = key.split('.');
    expect({ key, type: typeof resources[language][section]?.[name] }).toEqual({ key, type: 'string' });
  }
});
