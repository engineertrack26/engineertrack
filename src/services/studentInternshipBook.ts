import { supabase } from './supabase';

export interface StudentInternshipBook {
  student: {
    id: string; name: string; studentNumber: string; university: string;
    department: string; company: string; startDate: string; endDate: string;
  };
  groups: { id: string; name: string; term: string | null; joinedAt: string; leftAt: string | null; advisor: string }[];
  placements: { id: string; groupId: string; company: string; mentor: string; startDate: string; endDate: string }[];
  days: {
    id: string; date: string; company: string; attendance: string; checkInAt: string | null;
    decidedAt: string | null; decidedBy: string; attendanceNote: string;
    correctionRequested: boolean; logStatus: string; submittedAt: string | null;
    taskTitle: string | null; competencyName: string | null; experience: string | null;
    learning: string | null; nextStep: string | null; supportLevel: number | null;
    attachmentName: string | null;
  }[];
  tasks: {
    id: string; groupId: string; groupName: string; title: string; objective: string;
    criterion: string; description: string | null; status: string; submittedAt: string;
    reviewedAt: string | null; studentNote: string | null; reflection: string | null;
    reviewerNote: string | null; reviewedBy: string; selfLevel: number | null; reviewerLevel: number | null;
  }[];
  competencies: { groupId: string; groupName: string; name: string; targetLevel: number; reachedLevel: number }[];
}

/** The RPC is owner-only; still reject a malformed or switched-account result. */
export async function getMyInternshipBook(expectedStudentId: string): Promise<StudentInternshipBook> {
  const { data, error } = await supabase.rpc('my_internship_book');
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid internship book');
  const book = data as unknown as StudentInternshipBook;
  if (!book.student || book.student.id !== expectedStudentId || typeof book.student.name !== 'string' ||
      !Array.isArray(book.groups) || !Array.isArray(book.placements) || !Array.isArray(book.days) ||
      !Array.isArray(book.tasks) || !Array.isArray(book.competencies)) {
    throw new Error('Invalid internship book');
  }
  return book;
}
