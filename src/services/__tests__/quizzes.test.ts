import { supabase } from '../supabase';
import { quizService } from '../quizzes';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn(), storage: { from: jest.fn() } } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '123e4567-e89b-12d3-a456-426614174000' }));

beforeEach(() => jest.clearAllMocks());

test('saves the advisor question set and target list through one RPC', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
  await quizService.save('q1', { title: 'Safety', description: '', endsAt: null,
    audience: 'selected', targets: ['s1'], questions: [{ text: 'Helmet?', options: ['Yes', 'No'], correct: 0 }] });
  expect(supabase.rpc).toHaveBeenCalledWith('quiz_save', {
    p_id: 'q1', p_title: 'Safety', p_description: '', p_ends_at: null,
    p_audience: 'selected', p_target_ids: ['s1'],
    p_questions: [{ text: 'Helmet?', options: ['Yes', 'No'], correct: 0 }],
  });
});

test('submits the student answers through the scoring RPC', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: { saved: true, submittedAt: '2026-09-27' }, error: null } as never);
  await quizService.saveAnswers('q1', { '0': 1 }, true);
  expect(supabase.rpc).toHaveBeenCalledWith('quiz_save_answers',
    { p_id: 'q1', p_answers: { '0': 1 }, p_submit: true });
});

test('does not convert a quiz RPC refusal into a successful empty list', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'QUIZ_FORBIDDEN' } } as never);
  await expect(quizService.listStudent()).rejects.toThrow('QUIZ_FORBIDDEN');
});

test('keeps the Supabase client as this when calling an RPC', async () => {
  jest.mocked(supabase.rpc).mockImplementation(function (this: unknown) {
    if (this !== supabase) throw new Error('Supabase client context lost');
    return Promise.resolve({ data: [], error: null }) as never;
  });
  await expect(quizService.listStudent()).resolves.toEqual([]);
});
