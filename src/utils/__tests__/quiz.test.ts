import { quizAnswersComplete, quizDraftError, quizIsClosed } from '../quiz';

const questions = [{ text: 'Which?', options: ['A', 'B'], correct: 1 }];

test('requires a title, a valid question and one correct choice', () => {
  expect(quizDraftError('', questions)).toBe('quiz.titleRequired');
  expect(quizDraftError('Quiz', questions)).toBeNull();
  expect(quizDraftError('Quiz', [{ ...questions[0], correct: undefined }])).toBe('quiz.correctRequired');
  expect(quizDraftError('Quiz', [{ ...questions[0], options: ['A'] }])).toBe('quiz.optionsRequired');
  expect(quizDraftError('Quiz', Array.from({ length: 11 }, () => questions[0]))).toBe('quiz.questionLimit');
});

test('all questions must have an in-range answer', () => {
  expect(quizAnswersComplete({}, questions)).toBe(false);
  expect(quizAnswersComplete({ '0': 1 }, questions)).toBe(true);
  expect(quizAnswersComplete({ '0': 2 }, questions)).toBe(false);
});

test('deadline or manual close ends the attempt', () => {
  expect(quizIsClosed(null, null)).toBe(false);
  expect(quizIsClosed(null, new Date().toISOString())).toBe(true);
  expect(quizIsClosed('2000-01-01T00:00:00Z', null)).toBe(true);
});
