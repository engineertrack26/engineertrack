export type UserRole = 'student' | 'mentor' | 'advisor' | 'admin';

export type SupportedLanguage = 'en' | 'tr' | 'sr' | 'el' | 'it' | 'ro' | 'de';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  language: SupportedLanguage;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentProfile extends User {
  role: 'student';
  university: string;
  faculty?: string;
  department: string;
  departmentBranch?: string;
  studentId: string;
  mentorId: string;
  advisorId: string;
  internshipStartDate: string;
  internshipEndDate: string;
  companyName: string;
  companyAddress?: string;
  companySector?: string;
  totalXp: number;
  currentLevel: number;
  currentStreak: number;
  longestStreak: number;
}

export interface MentorProfile extends User {
  role: 'mentor';
  companyName: string;
  position: string;
  department: string;
  assignedStudentIds: string[];
}

export interface AdvisorProfile extends User {
  role: 'advisor';
  university: string;
  department: string;
  title: string;
  assignedStudentIds: string[];
}
