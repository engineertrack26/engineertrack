import { create } from 'zustand';
import { groupService } from '@/services/group';
import type { InternshipGroup } from '@/types/group';

// The advisor's groups, shared between the groups list and Student Monitor.
// Which group a screen is looking at is NOT held here: the per-group screens
// take the group id as a route param and look it up in `groups`, so there is
// exactly one source for "the current group" -- the URL.
interface GroupState {
  groups: InternshipGroup[];
  isLoading: boolean;
  fetchGroups: (advisorId: string) => Promise<void>;
  reset: () => void;
}

export const useGroupStore = create<GroupState>((set) => ({
  groups: [],
  isLoading: false,

  fetchGroups: async (advisorId: string) => {
    set({ isLoading: true });
    try {
      const groups = await groupService.listMyGroups(advisorId);
      set({ groups });
    } finally {
      set({ isLoading: false });
    }
  },

  reset: () => set({ groups: [], isLoading: false }),
}));
