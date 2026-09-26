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

  // Dead as of D3 task 5: app/(mentor)/review-log.tsx was its last caller and
  // has been deleted. Kept only because the rest of the daily-log service layer
  // is still standing; remove it when daily_logs itself goes.
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

  /** Four dashboard numbers on the task path. Pending count and the pending
   *  preview list are deliberately NOT computed here: the dashboard already
   *  fetches the pending queue once through assignmentService.listPendingReviews,
   *  and asking the same "status = submitted" question again here would let
   *  this and that disagree. See app/(mentor)/dashboard.tsx. */
  async getDashboardStats(mentorId: string) {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [students, reviewedResult, weekResult] = await Promise.all([
      this.getAssignedStudents(mentorId),
      // Approval rate: approved / reviewed, over this mentor's own reviews.
      // mentor_feedbacks.rating (a 1-5 score) has no equivalent on the task
      // path -- the mentor only approves or sends back -- so this replaces
      // the old average-rating card rather than faking a number for it.
      supabase
        .from('assignment_submissions')
        .select('status')
        .eq('reviewed_by', mentorId)
        .in('status', ['approved', 'needs_revision']),
      supabase
        .from('assignment_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('reviewed_by', mentorId)
        .gte('reviewed_at', startOfWeek.toISOString()),
    ]);

    if (reviewedResult.error) throw reviewedResult.error;
    if (weekResult.error) throw weekResult.error;

    const reviewedRows = (reviewedResult.data || []) as { status: string }[];
    const approvedCount = reviewedRows.filter((r) => r.status === 'approved').length;
    // null (not 0) when this mentor has never reviewed anything -- 0% approved
    // and "no data yet" are different facts, and the card below only shows
    // '-' for the latter.
    const approvalRate =
      reviewedRows.length > 0 ? Math.round((approvedCount / reviewedRows.length) * 100) : null;

    return {
      assignedCount: students?.length || 0,
      reviewedThisWeek: weekResult.count || 0,
      approvalRate,
      students: students || [],
    };
  },

  /** This mentor's reviews on task submissions -- assignment_submissions rows
   *  they reviewed, with a note attached. This is the task-path replacement
   *  for the old mentor_feedbacks-based history; mentor_feedbacks itself is
   *  untouched and still real, see getLegacyFeedbackHistory. */
  async getFeedbackHistory(mentorId: string) {
    const { data, error } = await supabase
      .from('assignment_submissions')
      .select(`
        id,
        assignment_id,
        student_id,
        status,
        mentor_note,
        reviewed_at,
        group_assignments (
          title
        ),
        profiles!assignment_submissions_student_id_fkey (
          first_name,
          last_name,
          avatar_url
        )
      `)
      .eq('reviewed_by', mentorId)
      .not('mentor_note', 'is', null)
      .order('reviewed_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /** The pre-task-path review history: mentor_feedbacks rows, with their 1-5
   *  rating intact. This is real feedback that predates the task path, not a
   *  fallback -- feedback.tsx shows it in its own clearly-labelled "earlier
   *  feedback" group rather than dropping it or rendering it with a blank
   *  star column. */
  async getLegacyFeedbackHistory(mentorId: string) {
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

  /** Existence check only, for the dashboard's "Review history" row: a count,
   *  not the rows themselves, from both sources getFeedbackHistory and
   *  getLegacyFeedbackHistory read. review_assignment now writes reviewed_by
   *  as the group's advisor, so a brand-new mentor's task-path count is
   *  structurally always 0 going forward -- the legacy count is the only one
   *  that can still be positive for an established mentor. */
  async hasFeedbackHistory(mentorId: string): Promise<boolean> {
    const [task, legacy] = await Promise.all([
      supabase.from('assignment_submissions').select('id', { count: 'exact', head: true })
        .eq('reviewed_by', mentorId).not('mentor_note', 'is', null),
      supabase.from('mentor_feedbacks').select('id', { count: 'exact', head: true })
        .eq('mentor_id', mentorId),
    ]);
    if (task.error) throw task.error;
    if (legacy.error) throw legacy.error;
    return (task.count || 0) > 0 || (legacy.count || 0) > 0;
  },

};
