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

  it('sends a mentor to the review queue for a submission', () => {
    expect(routeForNotification('task_submitted', { assignmentId: 'a1' }, 'mentor')).toEqual({
      pathname: '/(mentor)/pending-reviews',
      params: { assignmentId: 'a1', studentId: '' },
    });
  });

  it('opens an exact mentor review when the notification identifies the submission', () => {
    expect(routeForNotification('task_submitted', { submissionId: 's1', assignmentId: 'a1' }, 'mentor')).toEqual({
      pathname: '/(mentor)/review-detail', params: { id: 's1', studentId: '', assignmentId: '' },
    });
    expect(routeForNotification('task_submitted', { submissionId: 123, assignmentId: 'a1' }, 'mentor')).toEqual({
      pathname: '/(mentor)/pending-reviews', params: { assignmentId: 'a1', studentId: '' },
    });
  });

  it('never routes a notification type into a screen of the wrong role', () => {
    expect(routeForNotification('task_approved', { assignmentId: 'a1' }, 'mentor')).toBeNull();
    expect(routeForNotification('task_submitted', { assignmentId: 'a1' }, 'student')).toBeNull();
    expect(routeForNotification('task_submitted', { assignmentId: 'a1' }, 'advisor')).toBeNull();
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
});
