import { create } from 'zustand';
import { AppNotification } from '@/types/notification';
import { notificationService } from '@/services/notifications';
import { supabase } from '@/services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const PAGE_SIZE = 50;

interface NotificationState {
  notifications: AppNotification[];
  /** Server-side count over ALL of the user's rows -- never derived from the
   *  page held in `notifications`, which is at most the newest PAGE_SIZE. */
  unreadCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;

  fetchNotifications: (userId: string) => Promise<boolean>;
  fetchMore: (userId: string) => Promise<boolean>;
  fetchUnreadCount: (userId: string) => Promise<void>;
  markAsRead: (notificationId: string) => Promise<boolean>;
  markAllAsRead: (userId: string) => Promise<boolean>;
  subscribeToNotifications: (userId: string) => void;
  unsubscribe: () => void;
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

let generation = 0;
let pageRequest = 0;

let realtimeChannel: RealtimeChannel | null = null;

const initialState = {
  notifications: [] as AppNotification[],
  unreadCount: 0,
  isLoading: false,
  isLoadingMore: false,
  hasMore: true,
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  ...initialState,

  fetchNotifications: async (userId: string) => {
    const epoch = generation;
    const request = ++pageRequest;
    set({ isLoading: true });
    try {
      // The badge count comes from its own COUNT query, not from the page:
      // counting unread rows in the newest 50 would report at most 50 and
      // silently shrink a real 80 the moment the screen opened.
      const [data, unreadCount] = await Promise.all([
        notificationService.getAll(userId, PAGE_SIZE),
        notificationService.getUnreadCount(userId),
      ]);
      if (epoch !== generation || request !== pageRequest) return false;
      const mapped = (data || []).map((n: Record<string, unknown>) => mapDbNotification(n));
      set({ notifications: mapped, unreadCount, hasMore: mapped.length === PAGE_SIZE });
      return true;
    } catch {
      return false;
    } finally {
      if (epoch === generation && request === pageRequest) set({ isLoading: false });
    }
  },

  fetchMore: async (userId: string) => {
    const epoch = generation;
    const request = pageRequest;
    const { notifications, hasMore, isLoadingMore, isLoading } = get();
    if (!hasMore || isLoadingMore || isLoading || notifications.length === 0) return true;
    set({ isLoadingMore: true });
    try {
      const oldest = notifications[notifications.length - 1].createdAt;
      const data = await notificationService.getAll(userId, PAGE_SIZE, oldest);
      const mapped = (data || []).map((n: Record<string, unknown>) => mapDbNotification(n));
      if (epoch !== generation || request !== pageRequest) return false;
      const current = get().notifications;
      // Dedupe on id: a row sharing the cursor's exact created_at is
      // excluded by `lt` and would be lost, but one that slipped in through
      // the realtime prepend must not appear twice.
      const seen = new Set(current.map((n) => n.id));
      const fresh = mapped.filter((n) => !seen.has(n.id));
      set({
        notifications: [...current, ...fresh],
        hasMore: mapped.length === PAGE_SIZE,
      });
      return true;
    } catch {
      return false;
    } finally {
      if (epoch === generation) set({ isLoadingMore: false });
    }
  },

  fetchUnreadCount: async (userId: string) => {
    const epoch = generation;
    try {
      const count = await notificationService.getUnreadCount(userId);
      if (epoch === generation) set({ unreadCount: count });
    } catch (err) {
      console.error('Fetch unread count error:', err);
    }
  },

  markAsRead: async (notificationId: string) => {
    const epoch = generation;
    try {
      await notificationService.markAsRead(notificationId);
      if (epoch !== generation) return false;
      const { notifications, unreadCount } = get();
      const wasUnread = notifications.some((n) => n.id === notificationId && !n.isRead);
      const updated = notifications.map((n) =>
        n.id === notificationId ? { ...n, isRead: true } : n,
      );
      // Decrement the server-derived count rather than recounting the page.
      set({ notifications: updated, unreadCount: wasUnread ? Math.max(0, unreadCount - 1) : unreadCount });
      return true;
    } catch {
      return false;
    }
  },

  markAllAsRead: async (userId: string) => {
    const epoch = generation;
    try {
      await notificationService.markAllAsRead(userId);
      if (epoch !== generation) return false;
      const { notifications } = get();
      const updated = notifications.map((n) => ({ ...n, isRead: true }));
      set({ notifications: updated, unreadCount: 0 });
      return true;
    } catch {
      return false;
    }
  },

  subscribeToNotifications: (userId: string) => {
    // Cleanup existing subscription
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes' as never,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        } as never,
        (payload: { new?: Record<string, unknown> }) => {
          // The row arrives with the event, so put it at the top of the list
          // as well as bumping the badge -- a badge that goes up while the
          // list stays the same until a pull-to-refresh is two realities.
          const { notifications, unreadCount } = get();
          const row = payload?.new;
          if (!row || !row.id) {
            set({ unreadCount: unreadCount + 1 });
            return;
          }
          const incoming = mapDbNotification(row);
          if (notifications.some((n) => n.id === incoming.id)) return;
          set({
            notifications: [incoming, ...notifications],
            unreadCount: incoming.isRead ? unreadCount : unreadCount + 1,
          });
        },
      )
      .subscribe();

    realtimeChannel = channel;
  },

  unsubscribe: () => {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  },

  reset: () => {
    generation += 1;
    pageRequest += 1;
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    set(initialState);
  },
}));
