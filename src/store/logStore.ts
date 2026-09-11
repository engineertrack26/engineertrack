import { create } from 'zustand';
import { DailyLog } from '@/types/log';

// What is left of the daily-log store now that the log is retired: the
// student's log history still reads old logs, and that is the only reader.
// The create/edit state (currentLog, addLog, updateLog) went with the
// screens that used it.
interface LogState {
  logs: DailyLog[];
  setLogs: (logs: DailyLog[]) => void;
  reset: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  logs: [],
  setLogs: (logs) => set({ logs }),
  reset: () => set({ logs: [] }),
}));
