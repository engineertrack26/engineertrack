import type { SubmissionStatus } from '@/types/assignment';
import type { StampKind } from '@/components/common/Stamp';

/** Maps a submission's status to the Stamp the mentor's read-only screens
 *  show. The mentor never writes this status -- only the advisor's
 *  `review_assignment` does (2026-09-24-advisor-review-design.md, Decision
 *  1) -- so the mentor's list and detail screens both render the outcome as
 *  a fact through this one mapping, the way `Stamp` already renders it for
 *  the advisor's own screens. */
export function submissionStampKind(status: SubmissionStatus): StampKind {
  switch (status) {
    case 'approved': return 'approved';
    case 'needs_revision': return 'revision';
    default: return 'pending';
  }
}
