import { create } from 'zustand';

// Shared display count only: the queue remains the source of truth. Unknown
// counts are null, never a synthetic zero, and are scoped to the signed-in user.
interface MentorReviewState {
  ownerId: string | null;
  pendingCount: number | null;
  setCount: (ownerId: string, count: number) => void;
  invalidate: (ownerId: string) => void;
}

export const useMentorReviewStore = create<MentorReviewState>(set => ({
  ownerId: null,
  pendingCount: null,
  setCount: (ownerId, pendingCount) => set({ ownerId, pendingCount }),
  invalidate: ownerId => set(state => state.ownerId === ownerId
    ? { ownerId: null, pendingCount: null } : state),
}));
