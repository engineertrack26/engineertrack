import { create } from 'zustand';
import { Badge } from '@/types/gamification';

interface GamificationState {
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
  longestStreak: number;
  earnedBadges: string[];
  isLoading: boolean;

  setXp: (totalXp: number) => void;
  setLevel: (level: number) => void;
  setStreak: (current: number, longest: number) => void;
  setEarnedBadges: (badges: string[]) => void;
  addBadge: (badgeKey: string) => void;
  setLoading: (isLoading: boolean) => void;
  reset: () => void;
}

const initialState = {
  totalXp: 0,
  currentLevel: 1,
  currentStreak: 0,
  longestStreak: 0,
  earnedBadges: [] as string[],
  isLoading: false,
};

export const useGamificationStore = create<GamificationState>((set) => ({
  ...initialState,

  setXp: (totalXp) => set({ totalXp }),

  setLevel: (currentLevel) => set({ currentLevel }),

  setStreak: (currentStreak, longestStreak) =>
    set({ currentStreak, longestStreak }),

  setEarnedBadges: (earnedBadges) => set({ earnedBadges }),

  addBadge: (badgeKey) =>
    set((state) => ({
      earnedBadges: [...state.earnedBadges, badgeKey],
    })),

  setLoading: (isLoading) => set({ isLoading }),

  reset: () => set(initialState),
}));
