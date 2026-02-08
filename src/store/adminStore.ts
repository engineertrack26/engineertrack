import { create } from 'zustand';
import type { Institution, AdminDashboardStats, MemberWithProfile } from '@/types/institution';
import { adminService } from '@/services/admin';

interface AdminState {
  institution: Institution | null;
  members: MemberWithProfile[];
  stats: AdminDashboardStats;
  isLoading: boolean;
  fetchInstitution: (adminId: string) => Promise<void>;
  fetchMembers: (institutionId: string, filters?: { role?: string; search?: string }) => Promise<void>;
  fetchStats: (institutionId: string) => Promise<void>;
  setInstitution: (institution: Institution | null) => void;
  reset: () => void;
}

const initialStats: AdminDashboardStats = {
  totalStudents: 0,
  activeInternships: 0,
  totalAdvisors: 0,
  completionRate: 0,
};

export const useAdminStore = create<AdminState>((set) => ({
  institution: null,
  members: [],
  stats: initialStats,
  isLoading: false,

  fetchInstitution: async (adminId: string) => {
    set({ isLoading: true });
    try {
      const institution = await adminService.getInstitution(adminId);
      set({ institution });
    } catch (err) {
      console.error('fetchInstitution error:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMembers: async (institutionId: string, filters?) => {
    set({ isLoading: true });
    try {
      const members = await adminService.getInstitutionMembers(institutionId, filters);
      set({ members });
    } catch (err) {
      console.error('fetchMembers error:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchStats: async (institutionId: string) => {
    try {
      const stats = await adminService.getDashboardStats(institutionId);
      set({ stats });
    } catch (err) {
      console.error('fetchStats error:', err);
    }
  },

  setInstitution: (institution) => set({ institution }),

  reset: () => set({ institution: null, members: [], stats: initialStats, isLoading: false }),
}));
