export type PollType = 'quiz' | 'survey' | 'feedback';
export type QuestionType = 'multiple_choice' | 'single_choice' | 'text' | 'rating';

export interface PollOption {
  id: string;
  questionId: string;
  optionText: string;
  sortOrder: number;
}

export interface PollQuestion {
  id: string;
  pollId: string;
  questionText: string;
  questionType: QuestionType;
  sortOrder: number;
  correctOptionId?: string;
  options: PollOption[];
}

export interface Poll {
  id: string;
  creatorId: string;
  institutionId?: string;
  title: string;
  description?: string;
  pollType: PollType;
  targetRole: 'student' | 'mentor' | 'all';
  isActive: boolean;
  startsAt: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
  questions?: PollQuestion[];
  hasResponded?: boolean;
  responseCount?: number;
}

export interface PollResponse {
  id: string;
  pollId: string;
  userId: string;
  answers: Record<string, unknown>;
  score?: number;
  submittedAt: string;
}
