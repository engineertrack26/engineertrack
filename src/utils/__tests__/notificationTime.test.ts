import { notificationTimeAgo } from '../notificationTime';

const now = Date.parse('2026-09-12T12:00:00Z');
const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? key + ':' + opts.count : key;

describe('notification timestamps', () => {
  it.each(['', 'invalid-date'])('hides malformed timestamps: %s', (value) => {
    expect(notificationTimeAgo(value, t, 'tr', now)).toBe('');
  });
  it.each([
    [0, 'time.justNow'],
    [-60000, 'time.justNow'],
    [59000, 'time.justNow'],
    [60000, 'time.minutesAgo:1'],
    [59 * 60000, 'time.minutesAgo:59'],
    [3600000, 'time.hoursAgo:1'],
    [23 * 3600000, 'time.hoursAgo:23'],
    [24 * 3600000, 'time.daysAgo:1'],
    [6 * 24 * 3600000, 'time.daysAgo:6'],
  ])('formats an age of %i ms', (age, expected) => {
    expect(notificationTimeAgo(new Date(now - age).toISOString(), t, 'tr', now)).toBe(expected);
  });
  it.each(['tr', 'en', 'de', 'el', 'it', 'ro', 'sr'])('uses %s for older dates', (locale) => {
    const date = new Date(now - 7 * 24 * 3600000);
    expect(notificationTimeAgo(date.toISOString(), t, locale, now)).toBe(date.toLocaleDateString(locale));
  });
});
