export interface KpiTriplet {
  id: string;
  kpiId: string;
  tripletIndex: number;
  objective: string;
  task: string;
  criterion: string;
}

export type SubmissionStatus = 'submitted' | 'approved' | 'needs_revision';

export interface GroupAssignment {
  id: string;
  groupId: string;
  tripletId: string;
  title: string;
  description?: string;
  objective: string;
  criterion: string;
  dueDate?: string;
  createdAt: string;
}

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: SubmissionStatus;
  studentNote?: string;
  mentorNote?: string;
  logId?: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

/** One assignment's tallies as the SERVER counts them, which is not the same
 *  as what a select on assignment_submissions returns to an advisor -- that is
 *  scoped to active memberships, and the delete policy and freeze trigger are
 *  not. See group_assignment_counts in docs/task-assignment-rpcs.sql. */
export interface AssignmentCounts {
  assignmentId: string;
  submitted: number;
  approved: number;
  needsRevision: number;
}

/** An assignment as one student sees it: the task plus their own state, which
 *  is absent until they act on it. */
export interface MyAssignment extends GroupAssignment {
  submission?: AssignmentSubmission;
}
