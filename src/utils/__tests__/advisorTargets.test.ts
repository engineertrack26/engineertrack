import { sameTargets, toggleTarget, validTargets } from '../advisorTargets';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

test('dirty detection ignores key order but detects removed, added and changed targets', () => {
  expect(sameTargets({ a: 2, b: 3 }, { b: 3, a: 2 })).toBe(true);
  expect(sameTargets({ a: 2 }, { a: 3 })).toBe(false);
  expect(sameTargets({ a: 2 }, {})).toBe(false);
  expect(sameTargets({}, { a: 2 })).toBe(false);
  expect(sameTargets({}, {})).toBe(true);
});

test('selecting defaults to L2 and preserves all other targets without mutating the baseline', () => {
  const current = { a: 4, hidden: 1 };
  const next = toggleTarget(current, 'b');
  expect(next).toEqual({ a: 4, hidden: 1, b: 2 });
  expect(current).toEqual({ a: 4, hidden: 1 });
  expect(toggleTarget(next, 'a')).toEqual({ hidden: 1, b: 2 });
});

test('toggling a new choice twice restores the initial selection', () => {
  const initial = { a: 3 };
  expect(sameTargets(initial, toggleTarget(toggleTarget(initial, 'b'), 'b'))).toBe(true);
});

test('requires at least one target and only integer levels 1 through 4', () => {
  expect(validTargets({})).toBe(false);
  expect(validTargets({ a: 1, b: 2, c: 3, d: 4 })).toBe(true);
  for (const level of [0, -1, 5, 2.5, NaN, Infinity]) expect(validTargets({ a: level })).toBe(false);
});

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s supplies target labels and interpolations', (_language, locale) => {
  expect(Object.keys(locale.targetUi).sort()).toEqual(Object.keys(en.targetUi).sort());
  for (const key of Object.keys(en.targetUi) as Array<keyof typeof en.targetUi>) {
    expect(locale.targetUi[key].trim()).not.toBe('');
    expect((locale.targetUi[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.targetUi[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});
