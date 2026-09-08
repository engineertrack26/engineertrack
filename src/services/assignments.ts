import { supabase } from './supabase';
import { RpcError } from './rpcError';
import { signEvidence } from './evidenceUrls';
import type {
  KpiTriplet, GroupAssignment, MyAssignment, AssignmentSubmission,
  AssignmentCounts, PhotoEvidence, DocumentEvidence,
} from '@/types/assignment';
import { toPhotoPayload, toDocumentPayload } from '@/utils/evidenceMapping';

/** The nested embed every assignment query asks for, so the three roles cannot
 *  drift on how a task's competency is resolved.
 *
 *  group_assignments.triplet_id -> kpi_triplets.kpi_id -> competency_kpis
 *  (which holds the level) -> competencies (which holds the name). PostgREST
 *  walks the foreign keys; the advisor screen used to do the same two hops by
 *  hand with an extra round trip. */
export const COMPETENCY_EMBED =
  'kpi_triplets(competency_kpis(level, competencies(id, name)))';

/** Dig the competency name and level out of the nested embed.
 *
 *  PostgREST returns a to-one embed as an object, but returns null when the
 *  parent row's foreign key resolves to nothing, so every hop is checked
 *  rather than assumed. */
function readCompetency(
  r: Record<string, unknown>,
): { id?: string; name?: string; level?: number } {
  const triplet = r.kpi_triplets as Record<string, unknown> | null | undefined;
  const kpi = triplet?.competency_kpis as Record<string, unknown> | null | undefined;
  const competency = kpi?.competencies as Record<string, unknown> | null | undefined;
  return {
    id: (competency?.id as string) || undefined,
    name: (competency?.name as string) || undefined,
    level: typeof kpi?.level === 'number' ? (kpi.level as number) : undefined,
  };
}

function toAssignment(r: Record<string, unknown>): GroupAssignment {
  const competency = readCompetency(r);
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
    competencyId: competency.id,
    competencyName: competency.name,
    level: competency.level,
  };
}

function toSubmission(r: Record<string, unknown>): AssignmentSubmission {
  // log_photos/log_documents are embedded by listMyAssignments and
  // listPendingReviews -- every other caller of toSubmission leaves these two
  // undefined, which is exactly right for a select that never asked
  // PostgREST for them.
  const photosRaw = Array.isArray(r.log_photos)
    ? (r.log_photos as Array<Record<string, unknown>>) : undefined;
  const documentsRaw = Array.isArray(r.log_documents)
    ? (r.log_documents as Array<Record<string, unknown>>) : undefined;

  return {
    id: (r.id as string) || '',
    assignmentId: (r.assignment_id as string) || '',
    studentId: (r.student_id as string) || '',
    status: (r.status as AssignmentSubmission['status']) || 'submitted',
    studentNote: (r.student_note as string) || undefined,
    reflection: (r.reflection as string) || undefined,
    mentorNote: (r.mentor_note as string) || undefined,
    logId: (r.log_id as string) || undefined,
    submittedAt: (r.submitted_at as string) || '',
    reviewedAt: (r.reviewed_at as string) || undefined,
    reviewedBy: (r.reviewed_by as string) || undefined,
    photos: photosRaw?.map((p) => ({
      uri: (p.uri as string) || '',
      caption: (p.caption as string) || undefined,
    })),
    documents: documentsRaw?.map((d) => ({
      uri: (d.uri as string) || '',
      fileName: (d.file_name as string) || '',
      fileType: (d.file_type as string) || '',
      fileSize: (d.file_size as number) ?? 0,
    })),
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
    // The only .from() write in this file that can fail with a DOMAIN code
    // rather than an infrastructure one: trg_assignment_within_scope raises
    // NOT_IN_SCOPE from a BEFORE INSERT trigger, so this insert has to be
    // wrapped like an .rpc() call for mapRpcError to reach it. The plain
    // `throw error` used by the reads below stays correct -- they cannot raise
    // a code we have a message for.
    if (error) throw new RpcError(error.message);
    return toAssignment(data as Record<string, unknown>);
  },

  async listGroupAssignments(groupId: string): Promise<GroupAssignment[]> {
    const { data, error } = await supabase
      .from('group_assignments')
      .select(`*, ${COMPETENCY_EMBED}`)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => toAssignment(r as Record<string, unknown>));
  },

  /** title, description and due_date are always editable. objective, criterion
   *  and triplet_id are frozen by trg_freeze_assessed_assignment once any
   *  submission exists, and the attempt comes back as ASSIGNMENT_LOCKED. */
  async updateAssignment(
    id: string,
    patch: {
      title?: string; description?: string | null; dueDate?: string | null;
      objective?: string; criterion?: string;
    },
  ): Promise<GroupAssignment> {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.objective !== undefined) row.objective = patch.objective;
    if (patch.criterion !== undefined) row.criterion = patch.criterion;

    const { data, error } = await supabase
      .from('group_assignments')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new RpcError(error.message);
    return toAssignment(data as Record<string, unknown>);
  },

  /** Permitted only while no student has acted on it — the DELETE policy
   *  carries `NOT assignment_has_submissions(id)`, so a withdrawal of an
   *  assessed assignment silently affects zero rows rather than raising. */
  async deleteAssignment(id: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('group_assignments')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new RpcError(error.message);
    return (data || []).length > 0;
  },

  /** Per-assignment tallies for the advisor's screen.
   *
   *  Deliberately an RPC and not a select on assignment_submissions. That
   *  select is scoped by the table's SELECT policy, which reaches an advisor
   *  through is_group_advisor_of(student_id) and so needs an ACTIVE membership,
   *  while assignment_has_submissions -- the delete policy and the freeze
   *  trigger -- asks only about the row. A student who submits and then joins
   *  another group vanishes from the select and not from the trigger, and the
   *  screen prints "0 submitted" one moment and takes ASSIGNMENT_LOCKED the
   *  next. This counts what the server enforces against. */
  async getAssignmentCounts(groupId: string): Promise<AssignmentCounts[]> {
    const { data, error } = await supabase.rpc('group_assignment_counts', {
      p_group_id: groupId,
    });
    if (error) throw new RpcError(error.message);
    return ((data as Array<Record<string, unknown>>) || []).map((r) => ({
      assignmentId: (r.assignment_id as string) || '',
      submitted: (r.submitted as number) ?? 0,
      approved: (r.approved as number) ?? 0,
      needsRevision: (r.needs_revision as number) ?? 0,
    }));
  },

  /** The `logId` parameter is gone. D1 dropped the three-argument signature --
   *  a differing argument list would have made an OVERLOAD, and PostgREST
   *  resolves overloads by the argument names the caller sends, so the old body
   *  would have kept answering old callers with no error anywhere. */
  async submitAssignment(
    assignmentId: string,
    note: string,
    reflection: string,
    photos: PhotoEvidence[],
    documents: DocumentEvidence[],
  ): Promise<string> {
    const { data, error } = await supabase.rpc('submit_assignment', {
      p_assignment_id: assignmentId,
      p_note: note,
      p_reflection: reflection,
      p_photos: toPhotoPayload(photos),
      p_documents: toDocumentPayload(documents),
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
      // Evidence is embedded here, not fetched separately, because opening a
      // card must prefill it: submit_assignment deletes and rewrites
      // log_photos/log_documents rather than appending, so a resubmission
      // built from a blank picker would erase whatever was uploaded before.
      .select(`*, ${COMPETENCY_EMBED}, assignment_submissions(*, log_photos(*), log_documents(*))`)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Signed at read time, not stored: log-photos and log-documents are private
    // buckets, so the getPublicUrl written at upload is a dead link, and a
    // signed URL expires -- storing one would only postpone the broken link.
    return Promise.all((data || []).map(async (row) => {
      const r = row as Record<string, unknown>;
      const all = Array.isArray(r.assignment_submissions) ? r.assignment_submissions : [];
      // PostgREST returns every submission on the assignment, not just this
      // student's — the RLS policy lets an advisor read them all.
      const mine = (all as Array<Record<string, unknown>>)
        .find((s) => s.student_id === studentId);
      if (!mine) return { ...toAssignment(r), submission: undefined };

      const submission = toSubmission(mine);
      const signed = await signEvidence(submission.photos, submission.documents);
      return {
        ...toAssignment(r),
        submission: { ...submission, ...signed },
      };
    }));
  },

  /** Submissions waiting on this mentor. RLS already limits the rows to the
   *  students they supervise, so the status filter is the whole query.
   *
   *  The embed is an INNER join because the two tables are reached by different
   *  policies: the mentor reads assignment_submissions through
   *  is_mentor_of(student_id), which is group-independent, but reads
   *  group_assignments through mentors_a_member_of_group(group_id), which needs
   *  an ACTIVE membership. Close the student's membership, or let them join a
   *  new group, and the mentor keeps the submission while the assignment
   *  disappears — leaving a review card with no title, no task and, worst, no
   *  criterion, the one thing the mentor is supposed to judge against. A row
   *  they cannot evaluate is worse than a row they cannot see. */
  async listPendingReviews(): Promise<Array<AssignmentSubmission & { assignment: GroupAssignment }>> {
    const { data, error } = await supabase
      .from('assignment_submissions')
      // log_photos/log_documents embedded the same way listMyAssignments does,
      // so the mentor sees the evidence the student attached, not just their
      // note. The !inner on group_assignments is untouched -- see the comment
      // on this function for why a left join there would be wrong.
      .select(`*, group_assignments!inner(*, ${COMPETENCY_EMBED}), log_photos(*), log_documents(*)`)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true });
    if (error) throw error;

    // Same as listMyAssignments: the buckets are private, so the stored URL has
    // to be exchanged for a signed one before the mentor can see anything. This
    // is the screen where it matters most -- evidence the mentor cannot open is
    // evidence they cannot judge.
    return Promise.all((data || []).map(async (row) => {
      const r = row as Record<string, unknown>;
      const submission = toSubmission(r);
      const signed = await signEvidence(submission.photos, submission.documents);
      return {
        ...submission,
        ...signed,
        // The `!inner` above is what actually prevents a parentless row from
        // reaching here; this fallback only keeps the mapper total.
        assignment: toAssignment((r.group_assignments || {}) as Record<string, unknown>),
      };
    }));
  },
};
