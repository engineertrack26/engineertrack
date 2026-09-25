import { routeForNotification } from '@/utils/notificationRoutes';

describe('routeForNotification', () => {
  it('sends a student to their task, opened, for task notifications', () => {
    for (const type of ['task_assigned', 'task_approved', 'task_revision_requested']) {
      expect(routeForNotification(type, { assignmentId: 'a1' }, 'student')).toEqual({
        pathname: '/(student)/task-detail',
        params: { id: 'a1' },
      });
    }
  });

  it('still reaches the task list when the payload carries no id', () => {
    expect(routeForNotification('task_assigned', {}, 'student')).toEqual({
      pathname: '/(student)/my-tasks',
      params: undefined,
    });
    expect(routeForNotification('task_assigned', undefined, 'student')?.pathname).toBe('/(student)/my-tasks');
  });

  test('a submitted task sends the advisor to their review queue', () => {
    expect(routeForNotification('task_submitted', { submissionId: 's1' }, 'advisor'))
      .toEqual({ pathname: '/(advisor)/review-detail', params: { id: 's1', studentId: '', assignmentId: '' } });
    expect(routeForNotification('task_submitted', { assignmentId: 'a1' }, 'advisor'))
      .toEqual({ pathname: '/(advisor)/pending-reviews', params: { assignmentId: 'a1', studentId: '' } });
  });

  test('a mentor no longer has a review queue to open', () => {
    expect(routeForNotification('task_submitted', { submissionId: 's1' }, 'mentor')).toBeNull();
  });

  it('opens an exact advisor review when the notification identifies the submission', () => {
    expect(routeForNotification('task_submitted', { submissionId: 123, assignmentId: 'a1' }, 'advisor')).toEqual({
      pathname: '/(advisor)/pending-reviews', params: { assignmentId: 'a1', studentId: '' },
    });
  });

  it('never routes a notification type into a screen of the wrong role', () => {
    expect(routeForNotification('task_approved', { assignmentId: 'a1' }, 'mentor')).toBeNull();
    expect(routeForNotification('task_submitted', { assignmentId: 'a1' }, 'student')).toBeNull();
  });

  it('returns null with no role or an unknown type', () => {
    expect(routeForNotification('task_assigned', { assignmentId: 'a1' }, undefined)).toBeNull();
    expect(routeForNotification('general', {}, 'student')).toBeNull();
    expect(routeForNotification('something_new', {}, 'mentor')).toBeNull();
  });

  it('ignores a non-string assignment id rather than building a bad param', () => {
    expect(routeForNotification('task_assigned', { assignmentId: 42 }, 'student')?.params).toBeUndefined();
  });

  it('sends feed notifications to the role feed, opened on the post', () => {
    for (const type of ['feed_announcement', 'feed_poll', 'feed_comment']) {
      expect(routeForNotification(type, { postId: 'p1' }, 'student')).toEqual({
        pathname: '/(student)/feed',
        params: { post: 'p1' },
      });
    }
    expect(routeForNotification('feed_task_post', { postId: 'p1' }, 'advisor')).toEqual({
      pathname: '/(advisor)/feed',
      params: { post: 'p1' },
    });
  });

  it('never sends a mentor to a feed', () => {
    expect(routeForNotification('feed_announcement', { postId: 'p1' }, 'mentor')).toBeNull();
  });

  it('sends every internship-day notification to the internship-days screen of its role', () => {
    for (const role of ['student', 'mentor', 'advisor'] as const) {
      for (const type of ['internship_log_submitted', 'internship_attendance', 'internship_correction', 'internship_feedback']) {
        expect(routeForNotification(type, { dayId: 'd1' }, role)).toEqual({ pathname: `/(${role})/internship-days` });
      }
    }
  });

  it('sends closure notifications to the report for student and mentor, with both ids', () => {
    for (const role of ['student', 'mentor'] as const) {
      for (const type of ['internship_closed', 'internship_reopened']) {
        expect(routeForNotification(type, { studentId: 's1', groupId: 'g1' }, role)).toEqual({
          pathname: `/(${role})/internship-report`,
          params: { studentId: 's1', groupId: 'g1' },
        });
      }
    }
  });

  it('falls back to the dashboard for a closure notification missing an id', () => {
    for (const role of ['student', 'mentor'] as const) {
      expect(routeForNotification('internship_closed', { studentId: 's1' }, role)).toEqual({ pathname: `/(${role})/dashboard` });
      expect(routeForNotification('internship_reopened', {}, role)).toEqual({ pathname: `/(${role})/dashboard` });
    }
  });

  it('sends the advisor to student monitor for a closure notification, no ids needed', () => {
    expect(routeForNotification('internship_closed', { studentId: 's1', groupId: 'g1' }, 'advisor')).toEqual({
      pathname: '/(advisor)/student-monitor',
    });
    expect(routeForNotification('internship_reopened', {}, 'advisor')).toEqual({ pathname: '/(advisor)/student-monitor' });
  });

  it('sends a direct message to the conversation for every role', () => {
    for (const role of ['student', 'mentor', 'advisor'] as const) {
      expect(routeForNotification('direct_message', { conversationId: 'c1' }, role)).toEqual({
        pathname: `/(${role})/conversation`, params: { id: 'c1' },
      });
      expect(routeForNotification('direct_message', {}, role)?.pathname).toBe(`/(${role})/messages`);
    }
  });
});
