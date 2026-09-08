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
  /** The competency and level the task's triplet belongs to, resolved by the
   *  service so all three roles' cards read the same source. Optional because
   *  the nested embed can come back empty for a triplet whose KPI row is gone;
   *  the card then omits the line rather than showing a blank chip. */
  competencyId?: string;
  competencyName?: string;
  level?: number;
}

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: SubmissionStatus;
  studentNote?: string;
  reflection?: string;
  mentorNote?: string;
  logId?: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  photos?: PhotoEvidence[];
  documents?: DocumentEvidence[];
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

/** One photo as the client holds it before submitting. `uri` is the PUBLIC
 *  bucket URL returned by logService.uploadPhotoFile, not a device path -- the
 *  file is already uploaded by the time it reaches submit_assignment, which
 *  only writes the row. */
export interface PhotoEvidence {
  uri: string;
  caption?: string;
}

export interface DocumentEvidence {
  uri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}
