export type NotificationType =
  | 'log_approved'
  | 'log_revision_requested'
  | 'log_sent_back'
  | 'new_feedback'
  | 'badge_earned'
  | 'level_up'
  | 'poll_available'
  | 'general'
  | 'task_assigned'
  | 'task_submitted'
  | 'task_approved'
  | 'task_revision_requested'
  | 'feed_announcement'
  | 'feed_poll'
  | 'feed_comment'
  | 'feed_task_post'
  | 'direct_message'
  | 'internship_log_submitted'
  | 'internship_attendance'
  | 'internship_correction'
  | 'internship_feedback'
  | 'internship_closed'
  | 'internship_reopened';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  isRead: boolean;
  data?: Record<string, unknown>;
  createdAt: string;
}
