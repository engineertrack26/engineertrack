export type LogStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'needs_revision'
  | 'revised'
  | 'validated';

export interface DailyLog {
  id: string;
  studentId: string;
  date: string;
  title: string;
  content: string;
  activitiesPerformed: string;
  skillsLearned: string;
  challengesFaced: string;
  hoursSpent: number;
  status: LogStatus;
  photos: LogPhoto[];
  documents: LogDocument[];
  selfAssessment?: SelfAssessment;
  mentorFeedback?: MentorFeedback;
  revisionHistory: RevisionItem[];
  advisorNotes?: string;
  xpEarned: number;
  createdAt: string;
  updatedAt: string;
}

export interface LogPhoto {
  id: string;
  logId: string;
  uri: string;
  caption?: string;
  createdAt: string;
}

export interface LogDocument {
  id: string;
  logId: string;
  uri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
}

export interface SelfAssessment {
  id: string;
  logId: string;
  competencyRatings: Record<string, number>;
  reflectionNotes: string;
  createdAt: string;
}

export interface MentorFeedback {
  id: string;
  logId: string;
  mentorId: string;
  rating: number;
  comments: string;
  competencyRatings: Record<string, number>;
  isApproved: boolean;
  revisionRequired: boolean;
  revisionNotes?: string;
  areasOfExcellence?: string;
  createdAt: string;
}

export interface RevisionItem {
  id: string;
  logId: string;
  previousContent: string;
  newContent: string;
  reason: string;
  revisedAt: string;
}
