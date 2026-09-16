import type { ClosureStatus } from '@/types/closure';

/** The i18next TFunction shape this module needs -- key, default text, and
 *  optional interpolation values, per CLAUDE.md's `t(key, 'Default text')`
 *  convention. Kept narrow (rather than importing i18next's TFunction) so
 *  these helpers stay trivially unit-testable with a fake t. */
type Translate = (key: string, defaultValue: string, options?: Record<string, unknown>) => string;

/** A short status line for wherever a closure needs summarising (student
 *  monitor, growth screen, …): the close date when closed, "Reopened" for
 *  a row that exists but was reopened, or null when there has never been
 *  a closure for this student/group pair. */
export function closureLabel(status: ClosureStatus, t: Translate, locale?: string): string | null {
  if (status.closed) {
    const date = status.closedAt ? new Date(status.closedAt).toLocaleDateString(locale) : '';
    return t('closure.closedOn', 'Closed on {{date}}', { date });
  }
  if (status.reopenedAt) {
    return t('closure.reopened', 'Reopened');
  }
  return null;
}

/** Explains why the advisor's Close button is disabled. */
export function pendingReviewsMessage(n: number, t: Translate): string {
  return t('closure.pendingReviews', '{{count}} awaiting the mentor', { count: n });
}
