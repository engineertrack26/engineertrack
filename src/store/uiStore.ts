import { create } from 'zustand';
import { SupportedLanguage } from '@/types/user';

interface UIState {
  language: SupportedLanguage;
  isOnline: boolean;
  toastMessage: string | null;
  toastType: 'success' | 'error' | 'info' | null;

  setLanguage: (language: SupportedLanguage) => void;
  setOnline: (isOnline: boolean) => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
  reset: () => void;
}

const initialState = {
  language: 'en' as SupportedLanguage,
  isOnline: true,
  toastMessage: null,
  toastType: null as 'success' | 'error' | 'info' | null,
};

export const useUIStore = create<UIState>((set) => ({
  ...initialState,

  setLanguage: (language) => set({ language }),

  setOnline: (isOnline) => set({ isOnline }),

  showToast: (toastMessage, toastType) => set({ toastMessage, toastType }),

  hideToast: () => set({ toastMessage: null, toastType: null }),

  reset: () => set(initialState),
}));
