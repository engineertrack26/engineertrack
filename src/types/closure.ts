/** Mirrors internship_closure_status's JSONB shape exactly -- see
 *  docs/internship-closure-migration.sql. `closed` is true iff a closure
 *  row exists with reopened_at IS NULL; a reopened closure keeps its
 *  reopenedAt/reopenReason and its last reportVersion (history, not a
 *  live closure). */
export interface ClosureStatus {
  closed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  reportVersion: number | null;
  pendingReviews: number;
}
