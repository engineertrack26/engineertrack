import { supabase } from './supabase';
import { competencyService } from './competency';
import { groupService } from './group';
import { competencyCompletion, averageCompletion } from '@/utils/reportMetrics';
import type { CompetencyProgress } from '@/types/competency';
import type { CompetencyBreakdown, GroupReportData, StudentReportRow } from '@/types/report';

/** Daily logs were daily, so three days of nothing meant something. Tasks
 *  carry deadlines and a student may legitimately work several days on one,
 *  so the silence that is worth an advisor's attention starts a week out. */
const INACTIVITY_THRESHOLD_DAYS = 7;

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

  /** Completion here is competency attainment -- level reached against target
   *  -- and deliberately the same arithmetic `getReportsData` runs, because
   *  two advisor screens describing the same students must not disagree. It
   *  is NOT the old "distinct submitted log dates against the internship's
   *  calendar length", which was an attendance measure the app no longer
   *  makes and which nothing writes the rows for any more. */
  async getDashboardStats(advisorId: string) {
    const students = (await this.getAssignedStudents(advisorId)) || [];

    // Same guard getReportsData carries: an empty id reaches the RPC as an
    // invalid UUID (22P02) and, inside Promise.all, fails the whole dashboard
    // over one unresolvable row.
    const percentByStudent = new Map<string, number>();
    await Promise.all(
      students.map(async (s) => {
        const id = (s as Record<string, unknown>).id as string;
        if (!id) return;
        const progress = await competencyService.getProgress(id);
        percentByStudent.set(id, competencyCompletion(progress).percent);
      }),
    );

    const withPercent = students.map((s) => {
      const row = s as Record<string, unknown>;
      return {
        ...row,
        completionPercent: percentByStudent.get(row.id as string) || 0,
      };
    });

    return {
      assignedCount: students.length,
      avgCompletion: averageCompletion(withPercent.map((s) => ({ percent: s.completionPercent }))),
      students: withPercent,
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

  /** Who has gone quiet on the task path. Two rules carry this, and both are
   *  about not making a false accusation on the first screen an advisor sees:
   *
   *  1. The window is 7 days, not the daily log's 3. Logs were daily; a task
   *     has a deadline and a student may legitimately spend several days on
   *     one without that being silence.
   *  2. A student whose group has no PUBLISHED assignment is never inactive.
   *     Reaching "has never submitted" for someone nobody has given anything
   *     to do is the same false accusation in a new form. A draft is the
   *     advisor's own unsent preparation and RLS does not hide it from the
   *     advisor the way it hides it from students, so `published_at IS NOT
   *     NULL` is the only thing separating "assigned" from "being prepared". */
  async getInactiveStudents(advisorId: string) {
    const students = await this.getAssignedStudents(advisorId);
    if (!students || students.length === 0) return [];

    const studentIds = students.map((s) => s.id as string).filter(Boolean);
    if (studentIds.length === 0) return [];

    // `left_at IS NULL` is "still a member": a group the student has left
    // must not vouch for them having work to do.
    const { data: memberships, error: membershipsError } = await supabase
      .from('group_memberships')
      .select('student_id, group_id')
      .in('student_id', studentIds)
      .is('left_at', null);
    if (membershipsError) throw membershipsError;

    const groupByStudent = new Map<string, string>();
    (memberships || []).forEach((m) => {
      const row = m as Record<string, unknown>;
      groupByStudent.set(row.student_id as string, row.group_id as string);
    });

    const groupIds = Array.from(new Set(groupByStudent.values()));
    const groupsWithPublishedWork = new Set<string>();
    if (groupIds.length > 0) {
      const { data: assignments, error: assignmentsError } = await supabase
        .from('group_assignments')
        .select('group_id')
        .in('group_id', groupIds)
        .not('published_at', 'is', null);
      if (assignmentsError) throw assignmentsError;
      (assignments || []).forEach((a) => {
        groupsWithPublishedWork.add((a as Record<string, unknown>).group_id as string);
      });
    }

    // Rule 2 applied before anything is measured: a student with no published
    // assignment is not considered at all.
    const eligibleIds = studentIds.filter((id) => {
      const groupId = groupByStudent.get(id);
      return !!groupId && groupsWithPublishedWork.has(groupId);
    });
    if (eligibleIds.length === 0) return [];
    const eligible = new Set(eligibleIds);

    const { data: submissions, error: submissionsError } = await supabase
      .from('assignment_submissions')
      .select('student_id, submitted_at')
      .in('student_id', eligibleIds)
      .order('submitted_at', { ascending: false });
    if (submissionsError) throw submissionsError;

    const lastSubmissionByStudent = new Map<string, string>();
    (submissions || []).forEach((s) => {
      const row = s as Record<string, unknown>;
      const sid = row.student_id as string;
      if (!lastSubmissionByStudent.has(sid)) {
        lastSubmissionByStudent.set(sid, row.submitted_at as string);
      }
    });

    const inactiveStudents: {
      id: string;
      firstName: string;
      lastName: string;
      /** `null` is "has never submitted" -- an honest absence the screen
       *  renders as "no submissions yet", not a sentinel day count. */
      daysSinceLastSubmission: number | null;
    }[] = [];

    students.forEach((s) => {
      const row = s as Record<string, unknown>;
      const id = row.id as string;
      if (!eligible.has(id)) return;
      const profile = row.profiles as Record<string, unknown> | null;
      const last = lastSubmissionByStudent.get(id);
      const daysSince = last
        ? Math.floor((Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      if (daysSince === null || daysSince >= INACTIVITY_THRESHOLD_DAYS) {
        inactiveStudents.push({
          id,
          firstName: (profile?.first_name as string) || '',
          lastName: (profile?.last_name as string) || '',
          daysSinceLastSubmission: daysSince,
        });
      }
    });

    // Never-submitted first, then the longest silence.
    const rank = (d: number | null) => (d === null ? Number.MAX_SAFE_INTEGER : d);
    return inactiveStudents.sort(
      (a, b) => rank(b.daysSinceLastSubmission) - rank(a.daysSinceLastSubmission),
    );
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
    // group.ts maps a membership's student id as `(s.id as string) || ''` --
    // an empty string reaches competencyService.getProgress('') below, which
    // Postgres rejects as an invalid UUID (22P02) and, inside Promise.all,
    // fails the whole report over one unresolvable row. Drop those before
    // studentIds and the progress fan-out are built, rather than changing
    // group.ts out from under its other callers.
    const validMembers = members.filter((m) => m.id);
    const studentIds = validMembers.map((m) => m.id);

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

    const studentProgress: StudentReportRow[] = validMembers.map((m) => {
      const progress = progressByStudent.get(m.id) || [];
      const { percent } = competencyCompletion(progress);
      const mySubmissions = submissions.filter((s) => s.student_id === m.id);
      return {
        id: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        completionPercent: percent,
        // submitted is the TOTAL count, not "awaiting review" -- approved and
        // needs_revision are subsets of it, same convention as
        // group_assignment_counts (docs/task-assignment-rpcs.sql) and
        // AssignmentCard.tsx's canEditTerms, which reads submitted === 0 as
        // "nobody has submitted at all".
        submitted: mySubmissions.length,
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
      // Same convention as above: submitted is every submission, not just
      // the ones still awaiting review.
      submitted: submissions.length,
      approved: submissions.filter((s) => s.status === 'approved').length,
      needsRevision: submissions.filter((s) => s.status === 'needs_revision').length,
      competencyBreakdown: Array.from(competencyMap.values()),
      studentProgress,
    };
  },
};

