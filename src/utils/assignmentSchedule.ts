import type { GroupAssignment } from '@/types/assignment';

export type ScheduleState = 'draft' | 'scheduled' | 'overdue' | 'failed';

/** The pg_cron job runs once a minute, so a time that has only just passed
 *  has not been missed — the tick that will publish it is still up to 60
 *  seconds away, and the card is only re-read on refresh. Calling that
 *  `overdue` tells the advisor a healthy send "has not been sent" for the
 *  whole minute it is in flight. Twice the tick, so a slow run is covered
 *  too. */
const OVERDUE_GRACE_MS = 120 * 1000;

/** What a draft's card should say. `overdue` means the timer should have
 *  published this and did not — the only signal an advisor gets that the
 *  scheduler itself has stopped. */
export function scheduleState(
  a: Pick<GroupAssignment, 'scheduledFor' | 'scheduleError'>,
  now: Date = new Date(),
): ScheduleState {
  if (a.scheduleError) return 'failed';
  if (!a.scheduledFor) return 'draft';
  return new Date(a.scheduledFor).getTime() <= now.getTime() - OVERDUE_GRACE_MS
    ? 'overdue' : 'scheduled';
}

/** The due date is a local calendar day (`YYYY-MM-DD`), so the whole of that
 *  day is still on time; only a send after it is refused. */
export function sendBeforeDue(sendAtIso: string, dueDate?: string): boolean {
  if (!dueDate) return true;
  return new Date(sendAtIso).getTime() <= new Date(`${dueDate}T23:59:59`).getTime();
}
