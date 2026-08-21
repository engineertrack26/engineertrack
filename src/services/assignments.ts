import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type {
  KpiTriplet, GroupAssignment, MyAssignment, AssignmentSubmission,
} from '@/types/assignment';

function toAssignment(r: Record<string, unknown>): GroupAssignment {
  return {
    id: (r.id as string) || '',
    groupId: (r.group_id as string) || '',
    tripletId: (r.triplet_id as string) || '',
    title: (r.title as string) || '',
    description: (r.description as string) || undefined,
    objective: (r.objective as string) || '',
    criterion: (r.criterion as string) || '',
    dueDate: (r.due_date as string) || undefined,
    createdAt: (r.created_at as string) || '',
  };
}

function toSubmission(r: Record<string, unknown>): AssignmentSubmission {
  return {
    id: (r.id as string) || '',
    assignmentId: (r.assignment_id as string) || '',
    studentId: (r.student_id as string) || '',
    status: (r.status as AssignmentSubmission['status']) || 'submitted',
    studentNote: (r.student_note as string) || undefined,
    mentorNote: (r.mentor_note as string) || undefined,
    logId: (r.log_id as string) || undefined,
    submittedAt: (r.submitted_at as string) || '',
    reviewedAt: (r.reviewed_at as string) || undefined,
  };
}

export const assignmentService = {
  async listTriplets(kpiId: string): Promise<KpiTriplet[]> {
    const { data, error } = await supabase
      .from('kpi_triplets')
      .select('id, kpi_id, triplet_index, objective, task, criterion')
      .eq('kpi_id', kpiId)
      .order('triplet_index');
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => ({
      id: (r.id as string) || '',
      kpiId: (r.kpi_id as string) || '',
      tripletIndex: (r.triplet_index as number) ?? 0,
      objective: (r.objective as string) || '',
      task: (r.task as string) || '',
      criterion: (r.criterion as string) || '',
    }));
  },

  async createAssignment(input: {
    groupId: string; tripletId: string; title: string; description?: string;
    objective: string; criterion: string; dueDate?: string; createdBy: string;
  }): Promise<GroupAssignment> {
    const { data, error } = await supabase
      .from('group_assignments')
      .insert({
        group_id: input.groupId,
        triplet_id: input.tripletId,
        title: input.title,
        description: input.description ?? null,
        objective: input.objective,
        criterion: input.criterion,
        due_date: input.dueDate ?? null,
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return toAssignment(data as Record<string, unknown>);
  },

  async listGroupAssignments(groupId: string): Promise<GroupAssignment[]> {
    const { data, error } = await supabase
      .from('group_assignments')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => toAssignment(r as Record<string, unknown>));
  },

  async submitAssignment(assignmentId: string, note: string, logId: string | null): Promise<string> {
    const { data, error } = await supabase.rpc('submit_assignment', {
      p_assignment_id: assignmentId,
      p_note: note,
      p_log_id: logId,
    });
    if (error) throw new RpcError(error.message);
    return data as string;
  },

  async reviewAssignment(submissionId: string, approved: boolean, note: string): Promise<void> {
    const { error } = await supabase.rpc('review_assignment', {
      p_submission_id: submissionId,
      p_approved: approved,
      p_note: note,
    });
    if (error) throw new RpcError(error.message);
  },

  /** Every assignment for the student's group, with their own submission if
   *  they have acted on it. A student with no submission row has not started;
   *  the absence is the state, so this is a left join, not a filter. */
  async listMyAssignments(groupId: string, studentId: string): Promise<MyAssignment[]> {
    const { data, error } = await supabase
      .from('group_assignments')
      .select('*, assignment_submissions(*)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return (data || []).map((row) => {
      const r = row as Record<string, unknown>;
      const all = Array.isArray(r.assignment_submissions) ? r.assignment_submissions : [];
      // PostgREST returns every submission on the assignment, not just this
      // student's — the RLS policy lets an advisor read them all.
      const mine = (all as Array<Record<string, unknown>>)
        .find((s) => s.student_id === studentId);
      return {
        ...toAssignment(r),
        submission: mine ? toSubmission(mine) : undefined,
      };
    });
  },

  /** Submissions waiting on this mentor. RLS already limits the rows to the
   *  students they supervise, so the status filter is the whole query. */
  async listPendingReviews(): Promise<Array<AssignmentSubmission & { assignment: GroupAssignment }>> {
    const { data, error } = await supabase
      .from('assignment_submissions')
      .select('*, group_assignments(*)')
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true });
    if (error) throw error;

    return (data || []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ...toSubmission(r),
        assignment: toAssignment((r.group_assignments || {}) as Record<string, unknown>),
      };
    });
  },
};
