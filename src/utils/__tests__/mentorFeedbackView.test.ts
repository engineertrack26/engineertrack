import { mapTaskFeedback, mapLegacyFeedback, feedbackOutcome, filterFeedback, feedbackDate } from '../mentorFeedbackView';
import en from '@/i18n/locales/en.json';
import tr from '@/i18n/locales/tr.json';
import de from '@/i18n/locales/de.json';
import it from '@/i18n/locales/it.json';
import ro from '@/i18n/locales/ro.json';
import sr from '@/i18n/locales/sr.json';
import el from '@/i18n/locales/el.json';

const approved = mapTaskFeedback({ id: 'a', status: 'approved', mentor_note: 'Güzel çalışma',
  group_assignments: { title: 'Plan hazırla' }, profiles: { first_name: 'İpek', last_name: 'Yılmaz' } });
const revision = mapLegacyFeedback({ id: 'a', rating: 3, is_approved: false, revision_notes: 'Ekleri tamamla',
  daily_logs: { title: 'Günlük', date: '2026-09-13', profiles: { first_name: 'Ali', last_name: 'Usta' } } });

test('task reviews and legacy ratings keep their distinct shapes and notes', () => {
  expect(approved).toMatchObject({ kind: 'task', note: 'Güzel çalışma', approved: true });
  expect(approved).not.toHaveProperty('rating');
  expect(revision).toMatchObject({ kind: 'legacy', rating: 3, revisionNotes: 'Ekleri tamamla', logDate: '2026-09-13' });
});

test('only needs_revision is marked as revision for task submissions', () => {
  expect(feedbackOutcome(approved)).toBe('approved');
  expect(feedbackOutcome(revision)).toBe('revision');
  expect(feedbackOutcome(mapTaskFeedback({ status: 'needs_revision' }))).toBe('revision');
  expect(feedbackOutcome(mapTaskFeedback({ status: 'submitted' }))).toBe('other');
  expect(feedbackOutcome(mapTaskFeedback({}))).toBe('other');
});

test('search handles Turkish names, titles, notes and legacy revision notes', () => {
  const rows = [approved, revision];
  expect(filterFeedback(rows, ' ipek ', 'all', 'tr')).toEqual([approved]);
  expect(filterFeedback(rows, 'PLAN', 'approved', 'tr')).toEqual([approved]);
  expect(filterFeedback(rows, 'güzel', 'all', 'tr')).toEqual([approved]);
  expect(filterFeedback(rows, 'ekleri', 'revision', 'tr')).toEqual([revision]);
  expect(filterFeedback(rows, 'ekleri', 'approved', 'tr')).toEqual([]);
  expect(filterFeedback(rows, '', 'all', 'tr')).toEqual(rows);
});

test('dates use the selected locale and unknown dates remain unknown', () => {
  expect(feedbackDate('2026-09-13', 'tr')).toBe(new Date(2026, 8, 13, 12).toLocaleDateString('tr', { year: 'numeric', month: 'short', day: 'numeric' }));
  expect(feedbackDate('2026-09-13', 'en-US')).toBe('Sep 13, 2026');
  expect(feedbackDate('', 'tr')).toBe('');
  expect(feedbackDate('invalid', 'tr')).toBe('');
});

test.each(Object.entries({ en, tr, de, it, ro, sr, el }))('%s provides feedback history labels and interpolations', (_language, locale) => {
  expect(Object.keys(locale.feedbackUi).sort()).toEqual(Object.keys(en.feedbackUi).sort());
  for (const key of Object.keys(en.feedbackUi) as Array<keyof typeof en.feedbackUi>) {
    expect(locale.feedbackUi[key].trim()).not.toBe('');
    expect((locale.feedbackUi[key].match(/\{\{\w+\}\}/g) || []).sort())
      .toEqual((en.feedbackUi[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});
