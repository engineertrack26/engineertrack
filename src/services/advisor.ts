import { supabase } from './supabase';

export const advisorService = {
  async getAssignedStudents(advisorId: string) {
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
      .eq('advisor_id', advisorId);
    if (error) throw error;
    return data;
  },

  async getPendingValidationLogs(advisorId: string) {
    // First get assigned student IDs
    const { data: students, error: studentsError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('advisor_id', advisorId);
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
        ),
        mentor_feedbacks (
          rating,
          comments,
          competency_ratings,
          is_approved
        )
      `)
      .in('status', ['submitted', 'approved'])
      .in('student_id', studentIds)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  async getValidatedLogsCount(advisorId: string) {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Get assigned student IDs
    const { data: students, error: studentsError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('advisor_id', advisorId);
    if (studentsError) throw studentsError;

    const studentIds = (students || []).map((s) => s.id);
    if (studentIds.length === 0) return 0;

    const { count, error } = await supabase
      .from('daily_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'validated')
      .in('student_id', studentIds)
      .gte('updated_at', startOfWeek.toISOString());
    if (error) throw error;
    return count || 0;
  },

  async getDashboardStats(advisorId: string) {
    const [students, pendingLogs, validatedCount] = await Promise.all([
      this.getAssignedStudents(advisorId),
      this.getPendingValidationLogs(advisorId),
      this.getValidatedLogsCount(advisorId),
    ]);

    const studentIds = (students || []).map((s) => s.id);
    const { data: logs } = studentIds.length
      ? await supabase
          .from('daily_logs')
          .select('student_id, date, status')
          .in('student_id', studentIds)
      : { data: [] as Array<Record<string, unknown>> };

    const submittedDaysByStudent = new Map<string, number>();
    const seenDatesByStudent = new Map<string, Set<string>>();
    (logs || []).forEach((l) => {
      const row = l as Record<string, unknown>;
      const sid = row.student_id as string;
      const status = (row.status as string) || 'draft';
      const date = row.date as string;
      if (!sid || !date || status === 'draft') return;
      if (!seenDatesByStudent.has(sid)) {
        seenDatesByStudent.set(sid, new Set<string>());
      }
      seenDatesByStudent.get(sid)!.add(date);
    });
    seenDatesByStudent.forEach((dates, sid) => {
      submittedDaysByStudent.set(sid, dates.size);
    });

    // Calculate average completion percentage across students based on submitted days
    const completionPercentages = (students || []).map((s) => {
      const row = s as Record<string, unknown>;
      const submittedDays = submittedDaysByStudent.get(row.id as string) || 0;
      const start = row.internship_start_date as string | null;
      const end = row.internship_end_date as string | null;
      if (!start || !end || submittedDays <= 0) return 0;
      const startDate = new Date(start).getTime();
      const endDate = new Date(end).getTime();
      const total = endDate - startDate;
      if (total <= 0) return 0;
      const totalDays = Math.max(1, Math.ceil(total / (1000 * 60 * 60 * 24)));
      return Math.min(100, Math.max(0, Math.round((submittedDays / totalDays) * 100)));
    });
    const avgCompletion =
      completionPercentages.length > 0
        ? Math.round(completionPercentages.reduce((a, b) => a + b, 0) / completionPercentages.length)
        : 0;

    return {
      assignedCount: students?.length || 0,
      pendingCount: pendingLogs?.length || 0,
      validatedThisWeek: validatedCount,
      avgCompletion,
      students: (students || []).map((s) => {
        const row = s as Record<string, unknown>;
        return {
          ...row,
          submitted_days: submittedDaysByStudent.get(row.id as string) || 0,
        };
      }),
      pendingLogs: pendingLogs || [],
    };
  },

  async validateLog(logId: string, notes?: string) {
    const updateData: Record<string, unknown> = {
      status: 'validated',
      advisor_validated_at: new Date().toISOString(),
    };
    if (notes) {
      updateData.advisor_notes = notes;
    }
    const { data, error } = await supabase
      .from('daily_logs')
      .update(updateData)
      .eq('id', logId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async sendBackToMentor(logId: string, notes: string) {
    const { data, error } = await supabase
      .from('daily_logs')
      .update({
        status: 'submitted',
        advisor_notes: notes,
      })
      .eq('id', logId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getInactiveStudents(advisorId: string) {
    const students = await this.getAssignedStudents(advisorId);
    if (!students || students.length === 0) return [];

    const studentIds = students.map((s) => s.id);
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - 3);

    // Get the latest log date for each student
    const { data: logs, error: logsError } = await supabase
      .from('daily_logs')
      .select('student_id, date')
      .in('student_id', studentIds)
      .order('date', { ascending: false });
    if (logsError) throw logsError;

    // Find the most recent log per student
    const latestLogByStudent = new Map<string, string>();
    (logs || []).forEach((l) => {
      const row = l as Record<string, unknown>;
      const sid = row.student_id as string;
      if (!latestLogByStudent.has(sid)) {
        latestLogByStudent.set(sid, row.date as string);
      }
    });

    const inactiveStudents: {
      id: string;
      firstName: string;
      lastName: string;
      daysSinceLastLog: number;
    }[] = [];

    students.forEach((s) => {
      const row = s as Record<string, unknown>;
      const profile = row.profiles as Record<string, unknown> | null;
      const lastDate = latestLogByStudent.get(row.id as string);
      let daysSince: number;
      if (!lastDate) {
        // No logs exist yet for this student.
        daysSince = 999;
      } else {
        daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
      }

      if (daysSince >= 3) {
        inactiveStudents.push({
          id: row.id as string,
          firstName: (profile?.first_name as string) || '',
          lastName: (profile?.last_name as string) || '',
          daysSinceLastLog: daysSince,
        });
      }
    });

    return inactiveStudents.sort((a, b) => b.daysSinceLastLog - a.daysSinceLastLog);
  },

  async getStudentDetailedProgress(studentId: string) {
    // Get student profile with user info
    const { data: profile, error: profileError } = await supabase
      .from('student_profiles')
      .select(`
        *,
        profiles!student_profiles_id_fkey (
          first_name,
          last_name,
          avatar_url,
          email
        )
      `)
      .eq('id', studentId)
      .single();
    if (profileError) throw profileError;

    // Get log counts by status
    const { data: logs, error: logsError } = await supabase
      .from('daily_logs')
      .select('status')
      .eq('student_id', studentId);
    if (logsError) throw logsError;

    const logCounts = {
      total: logs?.length || 0,
      draft: 0,
      submitted: 0,
      approved: 0,
      validated: 0,
      needs_revision: 0,
    };
    (logs || []).forEach((l) => {
      const status = (l as Record<string, unknown>).status as string;
      if (status in logCounts) {
        logCounts[status as keyof typeof logCounts] = (logCounts[status as keyof typeof logCounts] as number) + 1;
      }
    });

    // Get average mentor feedback rating
    const { data: feedbacks, error: fbError } = await supabase
      .from('mentor_feedbacks')
      .select('rating, log_id!inner(student_id)')
      .eq('log_id.student_id', studentId);

    let avgMentorRating = 0;
    if (!fbError && feedbacks && feedbacks.length > 0) {
      avgMentorRating =
        feedbacks.reduce((sum, f) => sum + ((f as Record<string, unknown>).rating as number || 0), 0) /
        feedbacks.length;
    }

    return {
      profile,
      logCounts,
      avgMentorRating: Math.round(avgMentorRating * 10) / 10,
    };
  },

  async getReportsData(advisorId: string) {
    const students = await this.getAssignedStudents(advisorId);
    const studentIds = (students || []).map((s) => s.id);
    if (studentIds.length === 0) {
      return {
        totalStudents: 0,
        totalLogs: 0,
        approvedRate: 0,
        avgMentorScore: 0,
        studentProgress: [],
        statusBreakdown: { draft: 0, submitted: 0, approved: 0, validated: 0, needs_revision: 0 },
      };
    }

    // Get all logs for assigned students
    const { data: allLogs, error: logsError } = await supabase
      .from('daily_logs')
      .select('id, status, student_id, date')
      .in('student_id', studentIds);
    if (logsError) throw logsError;

    const statusBreakdown = { draft: 0, submitted: 0, approved: 0, validated: 0, needs_revision: 0 };
    (allLogs || []).forEach((l) => {
      const status = (l as Record<string, unknown>).status as string;
      if (status in statusBreakdown) {
        statusBreakdown[status as keyof typeof statusBreakdown]++;
      }
    });

    const totalLogs = allLogs?.length || 0;
    const approvedOrValidated = statusBreakdown.approved + statusBreakdown.validated;
    const approvedRate = totalLogs > 0 ? Math.round((approvedOrValidated / totalLogs) * 100) : 0;

    // Get average mentor score
    const { data: feedbacks, error: fbError } = await supabase
      .from('mentor_feedbacks')
      .select('rating')
      .in('log_id', (allLogs || []).map((l) => (l as Record<string, unknown>).id || '').filter(Boolean));

    let avgMentorScore = 0;
    if (!fbError && feedbacks && feedbacks.length > 0) {
      avgMentorScore =
        feedbacks.reduce((sum, f) => sum + ((f as Record<string, unknown>).rating as number || 0), 0) /
        feedbacks.length;
    }

    // Build student progress list
    const studentProgress = (students || []).map((s) => {
      const row = s as Record<string, unknown>;
      const profile = row.profiles as Record<string, unknown> | null;
      const studentLogs = (allLogs || []).filter(
        (l) => (l as Record<string, unknown>).student_id === row.id,
      );
      const start = row.internship_start_date as string | null;
      const end = row.internship_end_date as string | null;
      let completionPct = 0;
      if (start && end) {
        const submittedDays = new Set(
          studentLogs
            .filter((l) => ((l as Record<string, unknown>).status as string) !== 'draft')
            .map((l) => (l as Record<string, unknown>).date as string)
            .filter(Boolean),
        ).size;
        const startDate = new Date(start).getTime();
        const endDate = new Date(end).getTime();
        const total = endDate - startDate;
        if (total > 0) {
          const totalDays = Math.max(1, Math.ceil(total / (1000 * 60 * 60 * 24)));
          completionPct = Math.min(100, Math.max(0, Math.round((submittedDays / totalDays) * 100)));
        }
      }
      return {
        id: row.id as string,
        firstName: (profile?.first_name as string) || '',
        lastName: (profile?.last_name as string) || '',
        totalLogs: studentLogs.length,
        xp: (row.total_xp as number) || 0,
        level: (row.current_level as number) || 1,
        completionPct,
      };
    });

    return {
      totalStudents: students?.length || 0,
      totalLogs,
      approvedRate,
      avgMentorScore: Math.round(avgMentorScore * 10) / 10,
      studentProgress,
      statusBreakdown,
    };
  },
};

