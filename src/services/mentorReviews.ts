import { assignmentService } from './assignments';
import { supabase } from './supabase';
import { PendingReview, reviewNoteError, reviewVersion } from '@/utils/mentorReviews';
import type { SupervisionLevel } from '@/utils/selfAssessment';

export const mentorReviewService = {
  async names(items: PendingReview[]): Promise<Record<string, string>> {
    const ids = [...new Set(items.map(item => item.studentId).filter(Boolean))];
    if (!ids.length) return {};
    const { data, error } = await supabase.from('profiles').select('id, first_name, last_name').in('id', ids);
    if (error) throw error;
    return Object.fromEntries((data || []).map(row => [row.id, `${row.first_name || ''} ${row.last_name || ''}`.trim()]));
  },
  async list() {
    const items = await assignmentService.listPendingReviews({ signUrls: false });
    const names = await mentorReviewService.names(items);
    return { items, names };
  },
  async get(id: string) {
    const item = (await assignmentService.listPendingReviews({ submissionId: id }))[0] || null;
    const names = item ? await mentorReviewService.names([item]) : {};
    return { item, name: item ? names[item.studentId] || '' : '' };
  },
  async submit(item: PendingReview, approved: boolean, note: string, notification: { title: string; body: string }, level?: SupervisionLevel) {
    const errorKey = reviewNoteError(approved, note);
    if (errorKey) throw new Error(errorKey);
    // Reject stale screens, including a submission reviewed elsewhere. This
    // is a client freshness check; authorization remains in the existing RPC.
    const latest = (await assignmentService.listPendingReviews({ submissionId: item.id, signUrls: false }))[0];
    if (!latest || reviewVersion(latest) !== reviewVersion(item)) throw new Error('mentorFlow.reviewChanged');
    // review_assignment writes the student's notification in the same
    // transaction as the decision (simulation finding #11) -- nothing to send
    // from here any more. The `notification` argument stays for the callers'
    // sake; the copy is composed server-side in the shape notificationContent()
    // localises.
    void notification;
    await assignmentService.reviewAssignment(item.id, approved, note.trim(), level);
  },
};
