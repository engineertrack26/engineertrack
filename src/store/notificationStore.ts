import { create } from 'zustand';
import { AppNotification } from '@/types/notification';
import { notificationService } from '@/services/notifications';

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;

  fetchNotifications: (userId: string) => Promise<void>;
  fetchUnreadCount: (userId: string) => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: (userId: string) => Promise<void>;
  reset: () => void;
}

function mapDbNotification(n: Record<string, unknown>): AppNotification {
  return {
    id: n.id as string,
    userId: (n.user_id as string) || '',
    title: (n.title as string) || '',
    body: (n.body as string) || '',
    type: (n.type as AppNotification['type']) || 'general',
    isRead: (n.is_read as boolean) || false,
    data: (n.data as Record<string, unknown>) || undefined,
    createdAt: (n.created_at as string) || '',
  };
}

const initialState = {
  notifications: [] as AppNotification[],
  unreadCount: 0,
  isLoading: false,
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  ...initialState,

  fetchNotifications: async (userId: string) => {
    set({ isLoading: true });
    try {
      const data = await notificationService.getAll(userId);
      const mapped = (data || []).map((n: Record<string, unknown>) => mapDbNotification(n));
      const unread = mapped.filter((n) => !n.isRead).length;
      set({ notifications: mapped, unreadCount: unread });
    } catch (err) {
      console.error('Fetch notifications error:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchUnreadCount: async (userId: string) => {
    try {
      const count = await notificationService.getUnreadCount(userId);
      set({ unreadCount: count });
    } catch (err) {
      console.error('Fetch unread count error:', err);
    }
  },

  markAsRead: async (notificationId: string) => {
    try {
      await notificationService.markAsRead(notificationId);
      const { notifications } = get();
      const updated = notifications.map((n) =>
        n.id === notificationId ? { ...n, isRead: true } : n,
      );
      const unread = updated.filter((n) => !n.isRead).length;
      set({ notifications: updated, unreadCount: unread });
    } catch (err) {
      console.error('Mark as read error:', err);
    }
  },

  markAllAsRead: async (userId: string) => {
    try {
      await notificationService.markAllAsRead(userId);
      const { notifications } = get();
      const updated = notifications.map((n) => ({ ...n, isRead: true }));
      set({ notifications: updated, unreadCount: 0 });
    } catch (err) {
      console.error('Mark all as read error:', err);
    }
  },

  reset: () => set(initialState),
}));
