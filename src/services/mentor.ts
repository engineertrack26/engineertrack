import { supabase } from './supabase';

export const mentorService = {
  async getAssignedStudents(mentorId: string) {
    const { data, error } = await supabase
      .from('student_profiles')
      .select(`
        id,
        total_xp,
        current_level,
        current_streak,
        longest_streak,
        internship_start_date,
        internship_end_date,
        company_name,
        profiles!student_profiles_id_fkey (
          first_name,
          last_name,
          avatar_url
        )
      `)
      .eq('mentor_id', mentorId);
    if (error) throw error;
    return data;
  },

  async getPendingReviewLogs(mentorId: string) {
    // First get assigned student IDs
    const { data: students, error: studentsError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('mentor_id', mentorId);
    if (studentsError) throw studentsError;

    const studentIds = (students || []).map((s) => s.id);
    if (studentIds.length === 0) return [];

    const { data, error } = await supabase
      .from('daily_logs')
      .select(`
        *,
        profiles!daily_logs_student_id_fkey (
          first_name,
          last_name,
          avatar_url
        )
      `)
      .eq('status', 'submitted')
      .in('student_id', studentIds)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  async getReviewedLogsCount(mentorId: string) {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const { count, error } = await supabase
      .from('mentor_feedbacks')
      .select('id', { count: 'exact', head: true })
      .eq('mentor_id', mentorId)
      .gte('created_at', startOfWeek.toISOString());
    if (error) throw error;
    return count || 0;
  },

  async getDashboardStats(mentorId: string) {
    const [students, pendingLogs, reviewedCount] = await Promise.all([
      this.getAssignedStudents(mentorId),
      this.getPendingReviewLogs(mentorId),
      this.getReviewedLogsCount(mentorId),
    ]);

    // Calculate average rating from this mentor's feedbacks
    const { data: feedbacks, error: fbError } = await supabase
      .from('mentor_feedbacks')
      .select('rating')
      .eq('mentor_id', mentorId);
    if (fbError) throw fbError;

    const avgRating =
      feedbacks && feedbacks.length > 0
        ? feedbacks.reduce((sum, f) => sum + (f.rating || 0), 0) / feedbacks.length
        : 0;

    return {
      assignedCount: students?.length || 0,
      pendingCount: pendingLogs?.length || 0,
      reviewedThisWeek: reviewedCount,
      avgRating: Math.round(avgRating * 10) / 10,
      students: students || [],
      pendingLogs: pendingLogs || [],
    };
  },

  async getFeedbackHistory(mentorId: string) {
    const { data, error } = await supabase
      .from('mentor_feedbacks')
      .select(`
        *,
        daily_logs!mentor_feedbacks_log_id_fkey (
          id,
          title,
          date,
          student_id,
          profiles!daily_logs_student_id_fkey (
            first_name,
            last_name,
            avatar_url
          )
        )
      `)
      .eq('mentor_id', mentorId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Keep only the latest feedback per log (a log may have revision + approval records)
    const seen = new Set<string>();
    return (data || []).filter((row) => {
      const logId = (row as Record<string, unknown>).log_id as string;
      if (seen.has(logId)) return false;
      seen.add(logId);
      return true;
    });
  },
};
