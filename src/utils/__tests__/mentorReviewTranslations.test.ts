import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const languages = ['en', 'tr', 'de', 'it', 'ro', 'sr', 'el'];
const resources = Object.fromEntries(languages.map(language => [language,
  JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/locales', `${language}.json`), 'utf8')),
]));
const sources = ['app/(advisor)/pending-reviews.tsx', 'app/(advisor)/review-detail.tsx',
  'app/(mentor)/dashboard.tsx', 'app/(mentor)/_layout.tsx', 'app/(advisor)/_layout.tsx',
  'app/(mentor)/student-list.tsx', 'src/components/mentor/StudentDetail.tsx',
  'src/components/mentor/StudentIdentity.tsx', 'src/components/mentor/LinkStudentSheet.tsx',
  'src/components/mentor/ReviewUI.tsx', 'src/components/mentor/ReviewNoteSheet.tsx',
  'src/components/mentor/ReviewEvidence.tsx', 'src/utils/mentorReviews.ts'];
const usedKeys = [...new Set(sources.flatMap(path => [...readFileSync(join(process.cwd(), path), 'utf8')
  .matchAll(/['"]((?:mentorStudents|mentorHome|mentorFlow|common|studentFlow|mentor|tabs)\.[A-Za-z]+)['"]/g)].map(match => match[1])))];

describe('mentor review translations', () => {
  it.each(languages)('has all student management strings in %s', language => {
    const translated = resources[language].mentorStudents;
    expect(Object.keys(translated).sort()).toEqual(Object.keys(resources.en.mentorStudents).sort());
    for (const [key, value] of Object.entries(resources.en.mentorStudents)) {
      expect(typeof translated[key]).toBe('string');
      expect(translated[key].trim().length).toBeGreaterThan(0);
      expect(translated[key].match(/\{\{\w+\}\}/g) || []).toEqual(String(value).match(/\{\{\w+\}\}/g) || []);
    }
  });
  it.each(languages)('has all dashboard strings and interpolation fields in %s', language => {
    const translated = resources[language].mentorHome;
    expect(Object.keys(translated).sort()).toEqual(Object.keys(resources.en.mentorHome).sort());
    for (const [key, value] of Object.entries(resources.en.mentorHome)) {
      expect(typeof translated[key]).toBe('string');
      expect(translated[key].trim().length).toBeGreaterThan(0);
      expect(translated[key].match(/\{\{\w+\}\}/g) || []).toEqual(String(value).match(/\{\{\w+\}\}/g) || []);
    }
  });
  it.each(languages)('has all review strings and interpolation fields in %s', language => {
    const translated = resources[language].mentorFlow;
    expect(Object.keys(translated).sort()).toEqual(Object.keys(resources.en.mentorFlow).sort());
    for (const [key, value] of Object.entries(resources.en.mentorFlow)) {
      expect(typeof translated[key]).toBe('string');
      expect(translated[key].trim().length).toBeGreaterThan(0);
      expect(translated[key].match(/\{\{\w+\}\}/g) || []).toEqual(String(value).match(/\{\{\w+\}\}/g) || []);
    }
    for (const key of usedKeys) {
      const [section, name] = key.split('.');
      expect({ key, type: typeof resources[language][section]?.[name] }).toEqual({ key, type: 'string' });
    }
  });
});
