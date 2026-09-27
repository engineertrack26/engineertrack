import type { QuizQuestion } from '@/types/quiz';

export const MAX_QUIZ_QUESTIONS = 10;
export const MAX_QUIZ_OPTIONS = 5;

export function quizDraftError(title: string, questions: QuizQuestion[]): string | null {
  if (!title.trim() || title.trim().length > 120) return 'quiz.titleRequired';
  if (questions.length < 1 || questions.length > MAX_QUIZ_QUESTIONS) return 'quiz.questionLimit';
  for (const question of questions) {
    if (!question.text.trim() || question.text.trim().length > 500) return 'quiz.questionRequired';
    if (question.options.length < 2 || question.options.length > MAX_QUIZ_OPTIONS ||
        question.options.some(option => !option.trim() || option.trim().length > 200)) return 'quiz.optionsRequired';
    if (!Number.isInteger(question.correct) || question.correct! < 0 || question.correct! >= question.options.length) {
      return 'quiz.correctRequired';
    }
  }
  return null;
}

export function quizAnswersComplete(answers: Record<string, number>, questions: QuizQuestion[]): boolean {
  return questions.length > 0 && questions.every((q, index) => {
    const answer = answers[String(index)];
    return Number.isInteger(answer) && answer >= 0 && answer < q.options.length;
  });
}

export function quizIsClosed(endsAt: string | null, closedAt?: string | null): boolean {
  return !!closedAt || !!(endsAt && new Date(endsAt).getTime() <= Date.now());
}
