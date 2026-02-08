export type InstitutionType = 'university' | 'vocational_school' | 'other';

export interface Institution {
  id: string;
  name: string;
  type: InstitutionType;
  faculty?: string;
  department?: string;
  city?: string;
  country: string;
  adminId: string;
  institutionCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  institutionId: string;
  name: string;
  departmentCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProfile {
  id: string;
  institutionId?: string;
  eduEmail: string;
  eduVerified: boolean;
}

export interface StudentCode {
  id: string;
  studentId: string;
  code: string;
  isActive: boolean;
  createdAt: string;
}

export interface AdminDashboardStats {
  totalStudents: number;
  activeInternships: number;
  totalAdvisors: number;
  completionRate: number;
}

export interface MemberWithProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  avatarUrl?: string;
  departmentId?: string;
  createdAt: string;
}
