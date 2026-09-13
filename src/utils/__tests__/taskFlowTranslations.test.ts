import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s has every task workflow label and interpolation', (_language, locale) => {
  expect(Object.keys(locale.taskFlow).sort()).toEqual(Object.keys(en.taskFlow).sort());
  for (const key of Object.keys(en.taskFlow) as Array<keyof typeof en.taskFlow>) {
    expect(locale.taskFlow[key].trim().length).toBeGreaterThan(0);
    expect((locale.taskFlow[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.taskFlow[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});
