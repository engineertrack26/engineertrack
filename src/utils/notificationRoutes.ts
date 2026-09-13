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
          return assignmentId
            ? { pathname: '/(student)/task-detail', params: { id: assignmentId } }
            : { pathname: '/(student)/my-tasks', params: undefined };
        case 'log_approved':
        case 'log_revision_requested':
        case 'log_sent_back':
        case 'new_feedback':
          return { pathname: '/(student)/log-history' };
        case 'badge_earned':
        case 'level_up':
          return { pathname: '/(student)/achievements' };
        case 'feed_announcement':
        case 'feed_poll':
        case 'feed_comment':
        case 'feed_task_post': {
          const postId = str(data?.postId);
          return { pathname: '/(student)/feed', params: postId ? { post: postId } : undefined };
        }
        case 'direct_message': {
          const id = str(data?.conversationId);
          return id ? { pathname: '/(student)/conversation', params: { id } } : { pathname: '/(student)/messages' };
        }
        default:
          return null;
      }
    case 'mentor':
      switch (type) {
        case 'task_submitted':
          // New payloads may identify a submission. Older assignment-only
          // payloads filter the queue rather than choosing an arbitrary student.
          if (str(data?.submissionId)) return { pathname: '/(mentor)/review-detail', params: { id: str(data?.submissionId)!, studentId: '', assignmentId: '' } };
          return { pathname: '/(mentor)/pending-reviews', params: { assignmentId: assignmentId || '', studentId: '' } };
        case 'direct_message': {
          const id = str(data?.conversationId);
          return id ? { pathname: '/(mentor)/conversation', params: { id } } : { pathname: '/(mentor)/messages' };
        }
        default:
          return null;
      }
    case 'advisor':
      switch (type) {
        case 'feed_announcement':
        case 'feed_poll':
        case 'feed_comment':
        case 'feed_task_post': {
          const postId = str(data?.postId);
          return { pathname: '/(advisor)/feed', params: postId ? { post: postId } : undefined };
        }
        case 'direct_message': {
          const id = str(data?.conversationId);
          return id ? { pathname: '/(advisor)/conversation', params: { id } } : { pathname: '/(advisor)/messages' };
        }
        default:
          return null;
      }
    default:
      return null;
  }
}
