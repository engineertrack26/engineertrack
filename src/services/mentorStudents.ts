import { supabase } from './supabase';
import { mentorService } from './mentor';
import { mapMentorStudent } from '@/utils/mentorStudents';

export const mentorStudentService = {
  async students(mentorId: string) {
    return (await mentorService.getAssignedStudents(mentorId) || [])
      .map(row => mapMentorStudent(row as unknown as Record<string, unknown>));
  },
  async pendingCounts(studentIds: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (!studentIds.length) return counts;
    // Batch reads, no per-card requests or private attachment URL signing.
    // Page explicitly so the API row limit cannot silently undercount students.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('assignment_submissions')
        .select('id, student_id, group_assignments!inner(id)')
        .eq('status', 'submitted').in('student_id', studentIds)
        .order('id').range(offset, offset + 499);
      if (error) throw error;
      for (const row of data || []) counts[row.student_id] = (counts[row.student_id] || 0) + 1;
      if (!data || data.length < 500) return counts;
    }
  },
  async summary(studentId: string) {
    const count = async (status?: string) => {
      let query = supabase.from('assignment_submissions')
        .select('id, group_assignments!inner(id)', { count: 'exact', head: true }).eq('student_id', studentId);
      if (status) query = query.eq('status', status);
      const { count: total, error } = await query;
      if (error) throw error;
      if (total === null) throw new Error('Missing submission count');
      return total;
    };
    const [total, approved, pending] = await Promise.all([count(), count('approved'), count('submitted')]);
    return { total, approved, pending };
  },
};
