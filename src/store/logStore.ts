import { create } from 'zustand';
import { DailyLog } from '@/types/log';

interface LogState {
  logs: DailyLog[];
  currentLog: DailyLog | null;
  isLoading: boolean;
  error: string | null;

  setLogs: (logs: DailyLog[]) => void;
  setCurrentLog: (log: DailyLog | null) => void;
  addLog: (log: DailyLog) => void;
  updateLog: (logId: string, updates: Partial<DailyLog>) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  logs: [],
  currentLog: null,
  isLoading: false,
  error: null,
};

export const useLogStore = create<LogState>((set) => ({
  ...initialState,

  setLogs: (logs) => set({ logs }),

  setCurrentLog: (currentLog) => set({ currentLog }),

  addLog: (log) =>
    set((state) => ({
      logs: [log, ...state.logs],
    })),

  updateLog: (logId, updates) =>
    set((state) => ({
      logs: state.logs.map((log) =>
        log.id === logId ? { ...log, ...updates } : log,
      ),
      currentLog:
        state.currentLog?.id === logId
          ? { ...state.currentLog, ...updates }
          : state.currentLog,
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
