import { supabase } from './supabase';
import { competencyService } from './competency';
import { groupService } from './group';
import { competencyCompletion, averageCompletion } from '@/utils/reportMetrics';
import type { CompetencyProgress } from '@/types/competency';
import type { CompetencyBreakdown, GroupReportData, StudentReportRow } from '@/types/report';

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

  // Defense-in-depth helper: verify current user is assigned as advisor
  // to the student who owns the given log.
  async _assertAdvisorOfLog(logId: string): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: log, error: logErr } = await supabase
      .from('daily_logs')
      .select('student_id')
      .eq('id', logId)
      .single();
    if (logErr || !log) throw new Error('Log not found');

    const studentId = (log as Record<string, unknown>).student_id as string;

    const { data: sp, error: spErr } = await supabase
      .from('student_profiles')
      .select('advisor_id')
      .eq('id', studentId)
      .single();
    if (spErr || !sp) throw new Error('Student profile not found');
    if ((sp as Record<string, unknown>).advisor_id !== user.id) {
      throw new Error('Unauthorized: not assigned to this student');
    }

    return studentId;
  },

  async validateLog(logId: string, notes?: string) {
    await this._assertAdvisorOfLog(logId);

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
    await this._assertAdvisorOfLog(logId);

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

  /** Competency attainment and task volume for one group, scoped to its
   *  active students -- not `getAssignedStudents`, whose `advisor_id` column
   *  is a single value `join_group_by_code` overwrites per advisor and never
   *  clears on leaving, so it cannot tell two groups apart and keeps counting
   *  a departed student forever. `groupService.listMembers` already reads
   *  `group_memberships` scoped to this group with `left_at IS NULL`, which
   *  is exactly "only active memberships count". */
  async getReportsData(groupId: string): Promise<GroupReportData> {
    const [{ data: group, error: groupError }, members] = await Promise.all([
      supabase.from('internship_groups').select('id, name').eq('id', groupId).single(),
      groupService.listMembers(groupId),
    ]);
    if (groupError) throw groupError;

    const groupName = (group as Record<string, unknown> | null)?.name as string || '';
    const studentIds = members.map((m) => m.id);

    if (studentIds.length === 0) {
      return {
        groupId,
        groupName,
        studentCount: 0,
        averageCompletion: 0,
        submitted: 0,
        approved: 0,
        needsRevision: 0,
        competencyBreakdown: [],
        studentProgress: [],
      };
    }

    // Published assignments only -- a draft is preparation the advisor has
    // not sent yet. The RLS read policy does not hide drafts from the
    // advisor the way it hides them from students and mentors, so this
    // filter is the only thing separating "assigned" from "being prepared".
    const { data: assignments, error: assignmentsError } = await supabase
      .from('group_assignments')
      .select('id')
      .eq('group_id', groupId)
      .not('published_at', 'is', null);
    if (assignmentsError) throw assignmentsError;
    const assignmentIds = (assignments || []).map((a) => (a as Record<string, unknown>).id as string);

    let submissions: Array<{ student_id: string; status: string }> = [];
    if (assignmentIds.length > 0) {
      const { data: subs, error: subsError } = await supabase
        .from('assignment_submissions')
        .select('student_id, status')
        .in('assignment_id', assignmentIds)
        .in('student_id', studentIds);
      if (subsError) throw subsError;
      submissions = (subs || []) as Array<{ student_id: string; status: string }>;
    }

    const progressByStudent = new Map<string, CompetencyProgress[]>();
    await Promise.all(
      studentIds.map(async (id) => {
        progressByStudent.set(id, await competencyService.getProgress(id));
      }),
    );

    const studentProgress: StudentReportRow[] = members.map((m) => {
      const progress = progressByStudent.get(m.id) || [];
      const { percent } = competencyCompletion(progress);
      const mySubmissions = submissions.filter((s) => s.student_id === m.id);
      return {
        id: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        completionPercent: percent,
        submitted: mySubmissions.filter((s) => s.status === 'submitted').length,
        approved: mySubmissions.filter((s) => s.status === 'approved').length,
      };
    });

    const competencyMap = new Map<string, CompetencyBreakdown>();
    progressByStudent.forEach((progress) => {
      progress.forEach((p) => {
        const atTarget = p.currentLevel >= p.targetLevel ? 1 : 0;
        const existing = competencyMap.get(p.competencyId);
        if (existing) {
          existing.studentsAtTarget += atTarget;
        } else {
          competencyMap.set(p.competencyId, {
            competencyId: p.competencyId,
            competencyName: p.name,
            targetLevel: p.targetLevel,
            studentsAtTarget: atTarget,
          });
        }
      });
    });

    return {
      groupId,
      groupName,
      studentCount: studentIds.length,
      averageCompletion: averageCompletion(
        studentProgress.map((s) => ({ percent: s.completionPercent })),
      ),
      submitted: submissions.filter((s) => s.status === 'submitted').length,
      approved: submissions.filter((s) => s.status === 'approved').length,
      needsRevision: submissions.filter((s) => s.status === 'needs_revision').length,
      competencyBreakdown: Array.from(competencyMap.values()),
      studentProgress,
    };
  },
};

