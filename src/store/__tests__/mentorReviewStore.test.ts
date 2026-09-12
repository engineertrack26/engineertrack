import { useMentorReviewStore } from '../mentorReviewStore';

describe('mentor pending-review badge', () => {
  beforeEach(() => useMentorReviewStore.setState({ ownerId: null, pendingCount: null }));

  it('starts unknown rather than showing a false zero', () => {
    expect(useMentorReviewStore.getState().pendingCount).toBeNull();
  });
  it('shares an exact queue count, including a genuinely empty queue', () => {
    useMentorReviewStore.getState().setCount('mentor-a', 3);
    expect(useMentorReviewStore.getState()).toMatchObject({ ownerId: 'mentor-a', pendingCount: 3 });
    useMentorReviewStore.getState().setCount('mentor-a', 0);
    expect(useMentorReviewStore.getState().pendingCount).toBe(0);
  });
  it('invalidates a saved review or failed refresh until the queue is reloaded', () => {
    useMentorReviewStore.getState().setCount('mentor-a', 3);
    useMentorReviewStore.getState().invalidate('mentor-a');
    expect(useMentorReviewStore.getState()).toMatchObject({ ownerId: null, pendingCount: null });
  });
  it('does not let cleanup from a previous account erase the new account count', () => {
    useMentorReviewStore.getState().setCount('mentor-b', 2);
    useMentorReviewStore.getState().invalidate('mentor-a');
    expect(useMentorReviewStore.getState()).toMatchObject({ ownerId: 'mentor-b', pendingCount: 2 });
  });
});
