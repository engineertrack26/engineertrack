export type NotificationType =
  | 'log_approved'
  | 'log_revision_requested'
  | 'log_sent_back'
  | 'new_feedback'
  | 'badge_earned'
  | 'level_up'
  | 'poll_available'
  | 'general';

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
