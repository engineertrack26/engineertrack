export type UserRole = 'student' | 'mentor' | 'advisor';

export type SupportedLanguage = 'en' | 'tr' | 'el' | 'es' | 'it' | 'de';

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
  department: string;
  studentId: string;
  mentorId: string;
  advisorId: string;
  internshipStartDate: string;
  internshipEndDate: string;
  companyName: string;
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
