import { closureLabel, pendingReviewsMessage } from '@/utils/closure';
import type { ClosureStatus } from '@/types/closure';

const t = (key: string, _def: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key;

function status(overrides: Partial<ClosureStatus>): ClosureStatus {
  return {
    closed: false,
    closedAt: null,
    closedBy: null,
    reopenedAt: null,
    reopenReason: null,
    reportVersion: null,
    pendingReviews: 0,
    ...overrides,
  };
}

describe('closureLabel', () => {
  it('reports the close date when the internship is closed', () => {
    const closedAt = '2026-09-10T12:00:00Z';
    const expectedDate = new Date(closedAt).toLocaleDateString('en-US');
    const s = status({ closed: true, closedAt, closedBy: 'Jane', reportVersion: 2 });
    expect(closureLabel(s, t, 'en-US')).toBe(`closure.closedOn:${JSON.stringify({ date: expectedDate })}`);
  });

  it('reports "Reopened" for a row that exists but is not currently closed', () => {
    const s = status({ closed: false, closedAt: '2026-09-01T00:00:00Z', reopenedAt: '2026-09-12T00:00:00Z', reopenReason: 'mistake', reportVersion: 1 });
    expect(closureLabel(s, t)).toBe('closure.reopened');
  });

  it('returns null when there has never been a closure row', () => {
    const s = status({});
    expect(closureLabel(s, t)).toBeNull();
  });

  it('tolerates a closed status with no closedAt rather than throwing', () => {
    const s = status({ closed: true, closedAt: null });
    expect(closureLabel(s, t, 'en-US')).toBe(`closure.closedOn:${JSON.stringify({ date: '' })}`);
  });
});

describe('pendingReviewsMessage', () => {
  it('interpolates the count', () => {
    expect(pendingReviewsMessage(3, t)).toBe(`closure.pendingReviews:${JSON.stringify({ count: 3 })}`);
  });

  it('still renders for zero', () => {
    expect(pendingReviewsMessage(0, t)).toBe(`closure.pendingReviews:${JSON.stringify({ count: 0 })}`);
  });
});
