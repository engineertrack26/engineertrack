import { supabase } from './supabase';

export interface GroupExport {
  groupId: string; groupName: string; term: string | null; archived: boolean;
  attendanceTotals: { id: string; name: string; company: string; mentor: string; expectedDays: number; expectedSoFar: number; recorded: number; unrecorded: number; present: number; partial: number; excused: number; absent: number; pending: number; corrections: number; submittedLogs: number }[];
  students: { studentId: string; name: string; joinedAt: string; leftAt: string | null }[];
  competencies: { studentId: string; name: string; targetLevel: number; reachedLevel: number }[];
  tasks: { taskId: string; title: string; objective: string; criterion: string; description: string | null; dueDate: string | null; publishedAt: string }[];
  submissions: { taskId: string; studentId: string; status: string; submittedAt: string; reviewedAt: string | null; studentNote: string | null; reflection: string | null; reviewerNote: string | null; selfLevel: number | null; reviewerLevel: number | null }[];
  days: { studentId: string; date: string; company: string; attendance: string; checkInAt: string | null; decidedAt: string | null; attendanceNote: string; correctionRequested: boolean; logStatus: string; taskTitle: string | null; experience: string | null; learning: string | null; nextStep: string | null; supportLevel: number | null }[];
}

export async function getAdvisorGroupExport(groupId: string): Promise<GroupExport> {
  const { data, error } = await supabase.rpc('advisor_group_export', { p_group_id: groupId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid group export');
  const result = data as unknown as GroupExport;
  if (result.groupId !== groupId || typeof result.groupName !== 'string' ||
      !Array.isArray(result.students) || !Array.isArray(result.competencies) ||
      !Array.isArray(result.attendanceTotals) || !Array.isArray(result.tasks) ||
      !Array.isArray(result.submissions) || !Array.isArray(result.days)) throw new Error('Invalid group export');
  return result;
}
