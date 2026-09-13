// Two distinct histories, never merged into one shape: a task review has an
// outcome and a note, a legacy log review has a 1-5 rating. Forcing them into
// one interface is how you end up with a card that shows stars for a task
// that was never rated, or an outcome column blank for an old log review.
export interface TaskFeedbackItem {
  kind: 'task';
  id: string;
  assignmentTitle: string;
  note: string;
  approved: boolean;
  status: string;
  reviewedAt: string;
  studentFirstName: string;
  studentLastName: string;
}

export interface LegacyFeedbackItem {
  kind: 'legacy';
  id: string;
  logId: string;
  rating: number;
  comments: string;
  isApproved: boolean;
  revisionNotes?: string;
  createdAt: string;
  studentFirstName: string;
  studentLastName: string;
  logTitle: string;
  logDate: string;
}

export type FeedbackItem = TaskFeedbackItem | LegacyFeedbackItem;

export function mapTaskFeedback(row: Record<string, unknown>): TaskFeedbackItem {
  const assignment = row.group_assignments as Record<string, unknown> | null;
  const profile = row.profiles as Record<string, unknown> | null;
  return {
    kind: 'task',
    id: row.id as string,
    assignmentTitle: (assignment?.title as string) || '',
    note: (row.mentor_note as string) || '',
    approved: (row.status as string) === 'approved',
    status: (row.status as string) || '',
    reviewedAt: (row.reviewed_at as string) || '',
    studentFirstName: (profile?.first_name as string) || '',
    studentLastName: (profile?.last_name as string) || '',
  };
}

export function mapLegacyFeedback(row: Record<string, unknown>): LegacyFeedbackItem {
  const dailyLog = row.daily_logs as Record<string, unknown> | null;
  let studentFirstName = '';
  let studentLastName = '';

  if (dailyLog) {
    const profile = dailyLog.profiles as Record<string, unknown> | null;
    studentFirstName = (profile?.first_name as string) || '';
    studentLastName = (profile?.last_name as string) || '';
  }

  return {
    kind: 'legacy',
    id: row.id as string,
    logId: (row.log_id as string) || '',
    rating: (row.rating as number) || 0,
    comments: (row.comments as string) || '',
    isApproved: (row.is_approved as boolean) || false,
    revisionNotes: (row.revision_notes as string) || undefined,
    createdAt: (row.created_at as string) || '',
    studentFirstName,
    studentLastName,
    logTitle: (dailyLog?.title as string) || '',
    logDate: (dailyLog?.date as string) || '',
  };
}


export type FeedbackFilter = 'all' | 'approved' | 'revision';
export function feedbackOutcome(item: FeedbackItem): 'approved' | 'revision' | 'other' {
  if (item.kind === 'legacy') return item.isApproved ? 'approved' : 'revision';
  return item.status === 'approved' ? 'approved' : item.status === 'needs_revision' ? 'revision' : 'other';
}
export function filterFeedback<T extends FeedbackItem>(items: T[], query: string, filter: FeedbackFilter, locale: string): T[] {
  const search = query.trim().toLocaleLowerCase(locale);
  return items.filter((item) => (filter === 'all' || feedbackOutcome(item) === filter) &&
    [item.studentFirstName + ' ' + item.studentLastName,
      item.kind === 'task' ? item.assignmentTitle : item.logTitle,
      item.kind === 'task' ? item.note : item.comments,
      item.kind === 'legacy' ? item.revisionNotes : ''].some((value) => value?.toLocaleLowerCase(locale).includes(search)));
}
export function feedbackDate(value: string, locale: string): string {
  if (!value) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}
