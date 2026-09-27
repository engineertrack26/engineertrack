import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { RpcError } from './rpcError';
import { uploadToBucket } from './evidenceUrls';
import type { QuizAudience, QuizDetail, QuizQuestion, QuizResult, QuizSummary } from '@/types/quiz';

export const QUIZ_IMAGE_BUCKET = 'quiz-images';

type RpcResult = { data: unknown; error: { message: string } | null };

async function run<T>(request: PromiseLike<RpcResult>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new RpcError(error.message);
  return data as T;
}

export const quizService = {
  init(groupId: string) { return run<string>(supabase.rpc('quiz_init', { p_group_id: groupId })); },
  save(id: string, value: {
    title: string; description: string; endsAt: string | null;
    audience: QuizAudience; targets: string[]; questions: QuizQuestion[];
  }) {
    return run<void>(supabase.rpc('quiz_save', {
      p_id: id, p_title: value.title, p_description: value.description,
      // PostgreSQL accepts NULL; generated RPC argument types omit nullability.
      p_ends_at: value.endsAt as string, p_audience: value.audience,
      p_target_ids: value.targets,
      p_questions: value.questions.map(question => ({
        text: question.text, options: question.options,
        ...(question.correct !== undefined ? { correct: question.correct } : {}),
        ...(question.imagePath ? { imagePath: question.imagePath } : {}),
      })),
    }));
  },
  publish(id: string) { return run<number>(supabase.rpc('quiz_publish', { p_id: id })); },
  close(id: string) { return run<void>(supabase.rpc('quiz_close', { p_id: id })); },
  removeDraft(id: string) { return run<void>(supabase.rpc('quiz_delete_draft', { p_id: id })); },
  listAdvisor(groupId: string) { return run<QuizSummary[]>(supabase.rpc('quiz_list_advisor', { p_group_id: groupId })); },
  listStudent() { return run<QuizSummary[]>(supabase.rpc('quiz_list_student')); },
  detail(id: string) { return run<QuizDetail>(supabase.rpc('quiz_detail', { p_id: id })); },
  results(id: string) { return run<QuizResult[]>(supabase.rpc('quiz_results', { p_id: id })); },
  saveAnswers(id: string, answers: Record<string, number>, submit: boolean) {
    return run<{ saved: boolean; submittedAt: string | null }>(supabase.rpc('quiz_save_answers', {
      p_id: id, p_answers: answers, p_submit: submit,
    }));
  },
  async uploadImage(id: string, uri: string, mime: string): Promise<string> {
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const name = `${Crypto.randomUUID()}.${extension}`;
    const path = `${id}/${name}`;
    await uploadToBucket(QUIZ_IMAGE_BUCKET, path, uri, name, mime);
    return path;
  },
  async imageUrl(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from(QUIZ_IMAGE_BUCKET).createSignedUrl(path, 3600);
    if (error) throw error;
    return data?.signedUrl ?? null;
  },
  async removeImage(path: string): Promise<void> {
    const { error } = await supabase.storage.from(QUIZ_IMAGE_BUCKET).remove([path]);
    if (error) throw error;
  },
};
