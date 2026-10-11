import { defaultSendTime, formatSendTime, scheduleState, sendBeforeDue } from '@/utils/assignmentSchedule';

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

describe('defaultSendTime', () => {
  it('rounds up to the next half hour', () => {
    expect(defaultSendTime(new Date(2026, 9, 10, 14, 58, 30)).getHours()).toBe(16);
    expect(defaultSendTime(new Date(2026, 9, 10, 14, 58, 30)).getMinutes()).toBe(0);
    const d = defaultSendTime(new Date(2026, 9, 10, 14, 10, 0));
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([15, 30, 0]);
  });

  it('keeps an exact half hour or hour as it is', () => {
    const d = defaultSendTime(new Date(2026, 9, 10, 14, 30, 0));
    expect([d.getHours(), d.getMinutes()]).toEqual([15, 30]);
    const e = defaultSendTime(new Date(2026, 9, 10, 14, 0, 0));
    expect([e.getHours(), e.getMinutes()]).toEqual([15, 0]);
  });

  it('is never less than 59 minutes ahead, whatever the minute', () => {
    for (let m = 0; m < 24 * 60; m += 1) {
      const now = new Date(2026, 9, 10, 0, m, 59, 999);
      expect(defaultSendTime(now).getTime() - now.getTime()).toBeGreaterThanOrEqual(59 * 60 * 1000);
    }
  });
});

describe('formatSendTime', () => {
  const when = new Date(2026, 9, 11, 15, 13, 45);

  it('prints the minute and no seconds', () => {
    expect(formatSendTime(when, 'tr')).not.toMatch(/15[:.]13[:.]\d\d/);
    expect(formatSendTime(when, 'en')).not.toMatch(/3:13:\d\d/);
    expect(formatSendTime(when, 'tr')).toContain('15:13');
  });

  it('accepts an ISO string as the server sends it', () => {
    expect(formatSendTime(when.toISOString(), 'tr')).toBe(formatSendTime(when, 'tr'));
  });
});
