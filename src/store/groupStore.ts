import { create } from 'zustand';
import { groupService } from '@/services/group';
import type { InternshipGroup } from '@/types/group';

interface GroupState {
  groups: InternshipGroup[];
  activeGroup: InternshipGroup | null;
  isLoading: boolean;
  fetchGroups: (advisorId: string) => Promise<void>;
  setActiveGroup: (group: InternshipGroup | null) => void;
  reset: () => void;
}

export const useGroupStore = create<GroupState>((set) => ({
  groups: [],
  activeGroup: null,
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

  setActiveGroup: (group) => set({ activeGroup: group }),
  reset: () => set({ groups: [], activeGroup: null, isLoading: false }),
}));
