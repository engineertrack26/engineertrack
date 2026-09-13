import { previewText, dayGroups } from '@/utils/messageHelpers';

describe('previewText', () => {
  it('collapses whitespace and newlines to single spaces', () => {
    expect(previewText('hi\n\nthere   you', 80)).toBe('hi there you');
  });
  it('cuts at the limit with an ellipsis, never mid-surrogate', () => {
    expect(previewText('a'.repeat(100), 10)).toBe('aaaaaaaaa…');
    expect(previewText('😀😀😀😀', 3)).toBe('😀😀…');
  });
  it('returns the text unchanged when it fits', () => {
    expect(previewText('short', 80)).toBe('short');
  });
});

describe('dayGroups', () => {
  const m = (id: string, iso: string) => ({ id, senderId: 's', body: id, createdAt: iso });
  it('groups consecutive messages by local calendar day, oldest first', () => {
    // Built from local components (not fixed +03:00 literals) so the
    // grouping is correct on any machine's timezone.
    const t1 = new Date(2026, 8, 12, 23, 30).toISOString();
    const t2 = new Date(2026, 8, 13, 0, 10).toISOString();
    const t3 = new Date(2026, 8, 13, 9, 0).toISOString();
    const groups = dayGroups([m('a', t1), m('b', t2), m('c', t3)], 'en');
    expect(groups.map((g) => g.messages.map((x) => x.id))).toEqual([['a'], ['b', 'c']]);
    expect(groups[0].label).not.toBe(groups[1].label);
  });
  it('returns no groups for no messages', () => {
    expect(dayGroups([], 'en')).toEqual([]);
  });
});
