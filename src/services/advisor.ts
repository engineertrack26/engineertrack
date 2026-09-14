import { supabase } from './supabase';
import { competencyService } from './competency';
import { groupService } from './group';
import { competencyCompletion, averageCompletion } from '@/utils/reportMetrics';
import type { CompetencyProgress } from '@/types/competency';
import type { CompetencyBreakdown, GroupAttendance, GroupReportData, StudentReportRow } from '@/types/report';

/** Attendance for the report. The internship-days module is installed
 *  separately (docs/internship-days-migration.sql); a database without it
 *  answers "function not found", which is null here -- the rest of the
 *  report must not fail over an optional section. Any other error is real. */
async function groupAttendance(groupId: string): Promise<GroupAttendance | null> {
  const { data, error } = await supabase.rpc('internship_group_attendance', { p_group_id: groupId });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return null;
    throw error;
  }
  const raw = (data || {}) as Partial<GroupAttendance>;
  return { students: raw.students || [], days: raw.days || [] };
}

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

    // Same guard getReportsData carries in `validMembers`: an empty id reaches
    // the RPC as an invalid UUID (22P02), and a row with no id cannot be
    // rendered or keyed anyway, so it leaves the population entirely rather
    // than sitting in it scoring 0 and dragging the average down.
    const withId = students.filter((s) => !!(s as Record<string, unknown>).id);

    // "Active Students" means students with an active group membership -- the
    // same population Reports counts. student_profiles.advisor_id is never
    // cleared when a membership is closed, so without this a student the
    // advisor removed on Student Monitor would stay in the headcount and sit
    // in the average at 0% (no active group, so no targets, so no progress),
    // while Reports for the same group had already stopped counting them.
    const activeIds = new Set<string>();
    if (withId.length > 0) {
      const { data: memberships, error: membershipsError } = await supabase
        .from('group_memberships')
        .select('student_id')
        .in('student_id', withId.map((s) => (s as Record<string, unknown>).id as string))
        .is('left_at', null);
      if (membershipsError) throw membershipsError;
      (memberships || []).forEach((m) => {
        activeIds.add((m as Record<string, unknown>).student_id as string);
      });
    }
    const resolvable = withId.filter((s) =>
      activeIds.has((s as Record<string, unknown>).id as string),
    );

    // allSettled, not all: a bare Promise.all turns one student's failed RPC
    // into a rejected load, which dashboard.tsx catches into a console.error,
    // leaving the advisor looking at 0 students and 0% with nothing on screen
    // saying anything went wrong. A figure computed without one student beats
    // a screen of zeros.
    const settled = await Promise.allSettled(
      resolvable.map((s) =>
        competencyService.getProgress((s as Record<string, unknown>).id as string),
      ),
    );

    const percentByStudent = new Map<string, number>();
    settled.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      const id = (resolvable[i] as Record<string, unknown>).id as string;
      percentByStudent.set(id, competencyCompletion(result.value).percent);
    });

    const withPercent = resolvable.map((s) => {
      const row = s as Record<string, unknown>;
      return {
        ...row,
        completionPercent: percentByStudent.get(row.id as string) || 0,
        completionAvailable: percentByStudent.has(row.id as string),
      };
    });

    return {
      assignedCount: resolvable.length,
      progressResolvedCount: percentByStudent.size,
      // Only students whose progress actually resolved are in the average. A
      // student whose RPC failed stays in the list and the headcount -- they
      // are a real assigned student, and hiding them from their advisor is
      // worse -- but scoring them 0 here would report a read failure as a
      // lack of progress.
      avgCompletion: averageCompletion(
        Array.from(percentByStudent.values()).map((percent) => ({ percent })),
      ),
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
    // Assignment ids, not just group ids: the eligibility gate is scoped to
    // published work, so the activity measure must be too. Counting *any*
    // submission a student ever made lets a transfer hide a silence -- submit
    // to the old group's task, move groups two days later, ignore everything
    // the new group has published, and stay unflagged for five more days on
    // the strength of work done for a group you are no longer in.
    const publishedIdsByGroup = new Map<string, string[]>();
    if (groupIds.length > 0) {
      const { data: assignments, error: assignmentsError } = await supabase
        .from('group_assignments')
        .select('id, group_id')
        .in('group_id', groupIds)
        .not('published_at', 'is', null);
      if (assignmentsError) throw assignmentsError;
      (assignments || []).forEach((a) => {
        const row = a as Record<string, unknown>;
        const gid = row.group_id as string;
        const list = publishedIdsByGroup.get(gid);
        if (list) {
          list.push(row.id as string);
        } else {
          publishedIdsByGroup.set(gid, [row.id as string]);
        }
      });
    }

    // Rule 2 applied before anything is measured: a student with no published
    // assignment is not considered at all.
    const publishedIdsForStudent = (id: string): string[] => {
      const groupId = groupByStudent.get(id);
      return groupId ? publishedIdsByGroup.get(groupId) || [] : [];
    };
    const eligibleIds = studentIds.filter((id) => publishedIdsForStudent(id).length > 0);
    if (eligibleIds.length === 0) return [];
    const allPublishedIds = Array.from(
      new Set(eligibleIds.flatMap((id) => publishedIdsForStudent(id))),
    );

    // Two bounded reads rather than one unbounded one. A single
    // `.in('student_id', ...).order('submitted_at')` over the whole cohort
    // leans on PostgREST's db.max_rows (1000 on Supabase) to decide where to
    // stop: a semester of weekly tasks across thirty students crosses it, the
    // *quietest* students fall off the end of the descending page, and they
    // render as "No submissions yet" -- precisely the false accusation this
    // function exists to prevent, and silently, because a truncated page is
    // not an error.
    //
    // Read one: who submitted inside the window? Bounded by the window, and
    // truncating it is harmless -- anyone it drops is resolved exactly below.
    //
    // The cutoff is raw milliseconds, not `setDate(getDate() - 7)`, so it is
    // exactly the arithmetic the day count below uses and cannot drift by an
    // hour across a DST boundary. `.gt` and not `.gte` for the same reason:
    // a submission landing exactly on the cutoff is 7 days old, which is
    // `daysSince >= 7` and therefore flagged, as it was before this split.
    const cutoff = new Date(Date.now() - INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

    const { data: recent, error: recentError } = await supabase
      .from('assignment_submissions')
      .select('student_id, assignment_id')
      .in('student_id', eligibleIds)
      .in('assignment_id', allPublishedIds)
      .gt('submitted_at', cutoff.toISOString());
    if (recentError) throw recentError;

    const activeIds = new Set<string>();
    (recent || []).forEach((r) => {
      const row = r as Record<string, unknown>;
      const sid = row.student_id as string;
      // The `.in` above is a cross product over the advisor's groups; this
      // narrows each row to the student's own current group's work.
      if (publishedIdsForStudent(sid).includes(row.assignment_id as string)) {
        activeIds.add(sid);
      }
    });

    const silentIds = eligibleIds.filter((id) => !activeIds.has(id));
    if (silentIds.length === 0) return [];

    // Read two: only for the students who did not appear -- the handful about
    // to be flagged -- and exactly one row each, so nothing can be truncated.
    const lastSubmissionByStudent = new Map<string, string>();
    await Promise.all(
      silentIds.map(async (id) => {
        const { data, error } = await supabase
          .from('assignment_submissions')
          .select('submitted_at')
          .eq('student_id', id)
          .in('assignment_id', publishedIdsForStudent(id))
          .order('submitted_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        const row = (data || [])[0] as Record<string, unknown> | undefined;
        if (row) lastSubmissionByStudent.set(id, row.submitted_at as string);
      }),
    );

    const inactiveStudents: {
      id: string;
      firstName: string;
      lastName: string;
      /** `null` is "has never submitted" -- an honest absence the screen
       *  renders as "no submissions yet", not a sentinel day count. */
      daysSinceLastSubmission: number | null;
    }[] = [];

    // `silent` and not `eligible`: a student who appeared in read one has
    // submitted inside the window and is not considered further. Reading them
    // off `lastSubmissionByStudent`, which read two never filled for them,
    // would hand them a `null` and call them "No submissions yet".
    const silent = new Set(silentIds);
    students.forEach((s) => {
      const row = s as Record<string, unknown>;
      const id = row.id as string;
      if (!silent.has(id)) return;
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
    const [{ data: group, error: groupError }, members, attendance] = await Promise.all([
      supabase.from('internship_groups').select('id, name').eq('id', groupId).single(),
      groupService.listMembers(groupId),
      groupAttendance(groupId),
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
        // A student who left still has attendance history in the group.
        attendance,
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
      attendance,
    };
  },
};
