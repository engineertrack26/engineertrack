import { fromLocalIsoDate, toLocalIsoDate } from '@/utils/localDate';

describe('localDate', () => {
  it('formats in local time, zero-padded', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toLocalIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
  it('round-trips through local midnight without a day shift', () => {
    for (const iso of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
      expect(toLocalIsoDate(fromLocalIsoDate(iso)!)).toBe(iso);
    }
  });
  it('rejects malformed and overflowing dates', () => {
    expect(fromLocalIsoDate('2026-2-3')).toBeNull();
    expect(fromLocalIsoDate('2026-02-31')).toBeNull();
    expect(fromLocalIsoDate('2026-13-01')).toBeNull();
    expect(fromLocalIsoDate('')).toBeNull();
  });
});
