import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s has every task workflow label and interpolation', (_language, locale) => {
  expect(Object.keys(locale.taskFlow).sort()).toEqual(Object.keys(en.taskFlow).sort());
  for (const key of Object.keys(en.taskFlow) as (keyof typeof en.taskFlow)[]) {
    expect(locale.taskFlow[key].trim().length).toBeGreaterThan(0);
    expect((locale.taskFlow[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.taskFlow[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});

// The drafts tray shows these errors inline as the only explanation of why a
// scheduled task never went out, so they must be real sentences in every
// language (the rest of the errors section is not held to parity).
const SCHEDULE_ERROR_KEYS = ['notInScope', 'groupArchived', 'targetsRequired', 'scheduleInPast'] as const;
test.each(Object.entries({ tr, de, it, ro, sr, el }))('%s translates the scheduling error sentences', (_language, locale) => {
  for (const key of SCHEDULE_ERROR_KEYS) {
    const value = (locale.errors as Record<string, string>)[key];
    expect(typeof value).toBe('string');
    expect(value.trim().length).toBeGreaterThan(0);
    expect(value).not.toBe((en.errors as Record<string, string>)[key]);
  }
});
