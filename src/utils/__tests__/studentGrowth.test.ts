import { growthLevel, growthReason, leaderboardName } from '../studentGrowth';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

test('uses the existing level thresholds without awarding or recalculating levels', () => {
  expect(growthLevel(200, 2)).toMatchObject({ current: { level: 2 }, next: { level: 3 }, remaining: 100, progress: 0.5 });
  expect(growthLevel(100, 2).progress).toBe(0);
});

test('clamps progress and remaining XP when counters are temporarily inconsistent', () => {
  expect(growthLevel(0, 2).progress).toBe(0);
  expect(growthLevel(500, 2)).toMatchObject({ remaining: 0, progress: 1 });
});

test('maximum level has no infinite XP target', () => {
  expect(growthLevel(5000, 10)).toMatchObject({ next: undefined, remaining: 0, progress: 1 });
});

test('history labels do not expose transaction identifiers or unknown raw reasons', () => {
  expect(growthReason('assignment_submitted:private-id')).toBe('growthUi.submitted');
  expect(growthReason('assignment_approved:private-id')).toBe('growthUi.approved');
  expect(growthReason('unknown:private-id')).toBe('growthUi.xpUpdate');
  expect(growthReason('')).toBe('growthUi.xpUpdate');
});

test('surname stays limited to an initial, including unexpected full surname input', () => {
  expect(leaderboardName(' Ada ', ' y ', 'Student')).toBe('Ada Y.');
  expect(leaderboardName('Ada', 'Yılmaz', 'Student')).toBe('Ada Y.');
  expect(leaderboardName('Ada', '', 'Student')).toBe('Ada');
  expect(leaderboardName(' ', '', 'Öğrenci')).toBe('Öğrenci');
});

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s provides growth labels and matching placeholders', (_language, locale) => {
  expect(Object.keys(locale.growthUi).sort()).toEqual(Object.keys(en.growthUi).sort());
  for (const key of Object.keys(en.growthUi) as Array<keyof typeof en.growthUi>) {
    expect(locale.growthUi[key].trim()).not.toBe('');
    expect((locale.growthUi[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.growthUi[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});
