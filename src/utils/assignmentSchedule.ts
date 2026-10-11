import type { GroupAssignment } from '@/types/assignment';

export type ScheduleState = 'draft' | 'scheduled' | 'overdue' | 'failed';

/** What a draft's card should say. `overdue` means the timer should have
 *  published this and did not — the only signal an advisor gets that the
 *  scheduler itself has stopped. */
export function scheduleState(
  a: Pick<GroupAssignment, 'scheduledFor' | 'scheduleError'>,
  now: Date = new Date(),
): ScheduleState {
  if (a.scheduleError) return 'failed';
  if (!a.scheduledFor) return 'draft';
  return new Date(a.scheduledFor).getTime() <= now.getTime() ? 'overdue' : 'scheduled';
}

/** The due date is a local calendar day (`YYYY-MM-DD`), so the whole of that
 *  day is still on time; only a send after it is refused. */
export function sendBeforeDue(sendAtIso: string, dueDate?: string): boolean {
  if (!dueDate) return true;
  return new Date(sendAtIso).getTime() <= new Date(`${dueDate}T23:59:59`).getTime();
}
