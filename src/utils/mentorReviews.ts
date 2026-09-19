import type { AssignmentSubmission, GroupAssignment } from '@/types/assignment';
import { taskContent } from './taskContent';

export type PendingReview = AssignmentSubmission & { assignment: GroupAssignment };
export type ReviewSort = 'oldest' | 'newest';
export const REVIEW_NOTE_LIMIT = 1000;

export function reviewVersion(item: PendingReview): string {
  return JSON.stringify([item.id, item.assignmentId, item.studentId, item.status, item.submittedAt, item.reviewedAt]);
}
export function reviewNoteError(approved: boolean, note: string): string | null {
  if (!approved && !note.trim()) return 'mentorFlow.reasonRequired';
  if (note.trim().length > REVIEW_NOTE_LIMIT) return 'mentorFlow.noteTooLong';
  return null;
}
export function filterReviews(items: PendingReview[], names: Record<string, string>, query: string,
  order: ReviewSort, locale: string, assignmentId?: string, studentId?: string): PendingReview[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  return items.filter(item => (!assignmentId || item.assignmentId === assignmentId) && (!studentId || item.studentId === studentId) &&
    `${names[item.studentId] || ''} ${taskContent(item.assignment.title, locale)} ${item.assignment.title}`.toLocaleLowerCase(locale).includes(needle))
    .sort((a, b) => {
      const time = (Date.parse(a.submittedAt) || 0) - (Date.parse(b.submittedAt) || 0);
      return (order === 'oldest' ? time : -time) || a.id.localeCompare(b.id);
    });
}
export function reviewInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? [parts[0][0], parts.length > 1 ? parts[parts.length - 1][0] : ''].join('').toLocaleUpperCase() : '?';
}
export function reviewSubmittedAt(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
