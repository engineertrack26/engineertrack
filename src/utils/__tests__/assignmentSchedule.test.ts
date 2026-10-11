import { scheduleState, sendBeforeDue } from '@/utils/assignmentSchedule';

const NOW = new Date('2026-10-10T12:00:00Z');

describe('scheduleState', () => {
  it('is a plain draft when nothing is scheduled', () => {
    expect(scheduleState({}, NOW)).toBe('draft');
  });

  it('is scheduled while the time is still ahead', () => {
    expect(scheduleState({ scheduledFor: '2026-10-10T15:00:00Z' }, NOW)).toBe('scheduled');
  });

  // The job should have published this and did not. Surfacing it is the only
  // thing that makes a silent pg_cron outage visible to the advisor.
  it('is overdue once the time has passed and it is still unpublished', () => {
    expect(scheduleState({ scheduledFor: '2026-10-10T11:00:00Z' }, NOW)).toBe('overdue');
  });

  // The cron tick is a minute wide, so a time that has only just passed is
  // about to be published, not missed. Without the grace window a perfectly
  // healthy send reads "has not been sent" in red for up to a minute.
  it('is still scheduled inside the grace window after the time passes', () => {
    expect(scheduleState({ scheduledFor: '2026-10-10T11:59:59Z' }, NOW)).toBe('scheduled');
    expect(scheduleState({ scheduledFor: '2026-10-10T11:58:30Z' }, NOW)).toBe('scheduled');
  });

  it('is overdue once the grace window has elapsed', () => {
    expect(scheduleState({ scheduledFor: '2026-10-10T11:58:00Z' }, NOW)).toBe('overdue');
  });

  // A failed row's time is necessarily in the past, so both conditions hold.
  // Failed wins: it tells the advisor something is wrong, not merely late.
  it('is failed rather than overdue when the send was refused', () => {
    expect(scheduleState(
      { scheduledFor: '2026-10-10T11:00:00Z', scheduleError: 'GROUP_ARCHIVED' }, NOW,
    )).toBe('failed');
  });

  // Failed is decided before the clock is consulted at all, so the grace
  // window cannot hide a refusal that arrived seconds ago.
  it('is failed even for a time inside the grace window', () => {
    expect(scheduleState(
      { scheduledFor: '2026-10-10T11:59:59Z', scheduleError: 'GROUP_ARCHIVED' }, NOW,
    )).toBe('failed');
    expect(scheduleState(
      { scheduledFor: '2026-10-10T15:00:00Z', scheduleError: 'NOT_IN_SCOPE: x' }, NOW,
    )).toBe('failed');
  });
});

describe('sendBeforeDue', () => {
  it('accepts a send before the due date', () => {
    expect(sendBeforeDue('2026-10-11T15:00:00Z', '2026-10-20')).toBe(true);
  });

  // Otherwise the advisor hands a student a task that was already overdue
  // when it arrived.
  it('rejects a send after the due date', () => {
    expect(sendBeforeDue('2026-10-25T15:00:00Z', '2026-10-20')).toBe(false);
  });

  // The due date is a local calendar day; a send at any hour of that day is
  // still on time.
  // Built from local components: the due date is a local day, so a fixed UTC
  // instant would land on a different local day depending on the machine.
  it('accepts a send on the due date itself', () => {
    const lateThatDay = new Date(2026, 9, 20, 23, 0).toISOString();
    expect(sendBeforeDue(lateThatDay, '2026-10-20')).toBe(true);
  });

  it('accepts anything when there is no due date', () => {
    expect(sendBeforeDue('2026-10-25T15:00:00Z', undefined)).toBe(true);
  });
});

// Review Focus 5: timestamptz stores an instant. A time chosen before a DST
// change fires at that instant, which may be an hour off the wall clock the
// advisor pictured. That is the behaviour we want -- pinned here so nobody
// "fixes" it into a floating wall-clock time later.
describe('the stored value is an instant, not a wall clock', () => {
  // The same 13:00 wall-clock reading either side of the 2026 EU clock change
  // (+02:00 before, +01:00 after) is two different instants, an hour apart.
  // An implementation that compared wall clocks, ignoring the offset, would
  // call these equal and fail one of the two assertions. Uses explicit offsets
  // so the result does not depend on the machine's timezone.
  const beforeChange = '2026-10-25T13:00:00+02:00'; // 11:00Z
  const afterChange = '2026-10-25T13:00:00+01:00';  // 12:00Z
  const between = new Date('2026-10-25T11:30:00Z');

  it('treats the earlier instant as already due', () => {
    expect(scheduleState({ scheduledFor: beforeChange }, between)).toBe('overdue');
  });

  it('treats the later instant, same wall clock, as still ahead', () => {
    expect(scheduleState({ scheduledFor: afterChange }, between)).toBe('scheduled');
  });
});
