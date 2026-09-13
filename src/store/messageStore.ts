import { create } from 'zustand';
import { messageService } from '@/services/messages';

interface MessageState {
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  unreadCount: 0,
};

/** The unread-messages badge shown on the tab bar, kept in one store rather
 *  than per-layout state so the student/mentor/advisor layouts, MessagesScreen
 *  and ConversationScreen all read and refresh the same number. */
export const useMessageStore = create<MessageState>((set) => ({
  ...initialState,

  refreshUnread: async () => {
    try {
      const count = await messageService.unreadCount();
      set({ unreadCount: count });
    } catch (err) {
      console.warn('Unread message count refresh failed:', err instanceof Error ? err.message : err);
    }
  },

  reset: () => set(initialState),
}));
