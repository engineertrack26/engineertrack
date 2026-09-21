import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s provides auth form copy and matching placeholders', (_language, locale) => {
  expect(Object.keys(locale.authUi).sort()).toEqual(Object.keys(en.authUi).sort());
  for (const key of Object.keys(en.authUi) as (keyof typeof en.authUi)[]) {
    expect(locale.authUi[key].trim()).not.toBe('');
    expect((locale.authUi[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.authUi[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
  expect(locale.mentorProfile.showPassword.trim()).not.toBe('');
  expect(locale.mentorProfile.hidePassword.trim()).not.toBe('');
  expect(Object.keys(locale.recoveryUi).sort()).toEqual(Object.keys(en.recoveryUi).sort());
  Object.values(locale.recoveryUi).forEach(value => expect(value.trim()).not.toBe(''));
});
