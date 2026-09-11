import type { NotificationType } from '@/types/notification';
import type { UserRole } from '@/types/user';

/** Where tapping a notification should take the user, or null when the
 *  notification has no better destination than the list it was tapped in.
 *  Pure so it can be tested and so the push handler in app/_layout.tsx and
 *  the three in-app notification screens cannot disagree. */
export interface NotificationRoute {
  pathname: string;
  params?: Record<string, string>;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function routeForNotification(
  type: NotificationType | string,
  data: Record<string, unknown> | undefined,
  role: UserRole | undefined,
): NotificationRoute | null {
  const assignmentId = str(data?.assignmentId);

  switch (role) {
    case 'student':
      switch (type) {
        case 'task_assigned':
        case 'task_approved':
        case 'task_revision_requested':
          // `open` expands that task's card once the list has loaded.
          return { pathname: '/(student)/my-tasks', params: assignmentId ? { open: assignmentId } : undefined };
        case 'log_approved':
        case 'log_revision_requested':
        case 'log_sent_back':
        case 'new_feedback':
          return { pathname: '/(student)/log-history' };
        case 'badge_earned':
        case 'level_up':
          return { pathname: '/(student)/achievements' };
        case 'poll_available':
          return { pathname: '/(student)/polls' };
        default:
          return null;
      }
    case 'mentor':
      switch (type) {
        case 'task_submitted':
          // The RPC that writes this carries the assignment id only, so the
          // queue opens the first pending submission for that task.
          return { pathname: '/(mentor)/pending-reviews', params: assignmentId ? { assignmentId } : undefined };
        case 'poll_available':
          return { pathname: '/(mentor)/polls' };
        default:
          return null;
      }
    case 'advisor':
      switch (type) {
        case 'poll_available':
          return { pathname: '/(advisor)/polls' };
        default:
          return null;
      }
    default:
      return null;
  }
}
