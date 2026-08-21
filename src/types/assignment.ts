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
}

/** An assignment as one student sees it: the task plus their own state, which
 *  is absent until they act on it. */
export interface MyAssignment extends GroupAssignment {
  submission?: AssignmentSubmission;
}
