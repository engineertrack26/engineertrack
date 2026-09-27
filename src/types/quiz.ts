export interface QuizQuestion {
  text: string;
  options: string[];
  correct?: number;
  imagePath?: string;
}

export type QuizAudience = 'group' | 'selected';

export interface QuizSummary {
  id: string;
  title: string;
  description: string;
  questionCount: number;
  endsAt: string | null;
  publishedAt?: string | null;
  closedAt?: string | null;
  submittedAt?: string | null;
  closed?: boolean;
  score?: number | null;
  audience?: QuizAudience;
  targetCount?: number;
  submittedCount?: number;
}

export interface QuizDetail extends QuizSummary {
  groupId: string;
  audience: QuizAudience;
  questions: QuizQuestion[];
  targets: string[];
  answers: Record<string, number>;
}

export interface QuizResult {
  studentId: string;
  name: string;
  submittedAt: string | null;
  score: number | null;
  answers: Record<string, number> | null;
}
