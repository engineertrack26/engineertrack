import { supabase } from './supabase';
import { isStudentAvatarId, type StudentAvatarId } from '@/utils/studentAvatar';

export interface StudentAvatarState { avatarId: StudentAvatarId | null; level: number }
export async function getAdvisorStudentAvatars(groupId?: string): Promise<Record<string, StudentAvatarState>> {
  const { data, error } = await supabase.rpc('advisor_student_avatars', { p_group_id: groupId ?? null });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Invalid advisor avatar response');
  const result: Record<string, StudentAvatarState> = Object.create(null);
  for (const row of data) {
    if (!row || typeof row.studentId !== 'string' || !row.studentId) throw new Error('Invalid student ID');
    result[row.studentId] = parseStudentAvatar(row);
  }
  return result;
}
export function parseStudentAvatar(data: unknown): StudentAvatarState {
  if (!data || typeof data !== 'object') throw new Error('Invalid avatar response');
  const row = data as Record<string, unknown>;
  if ((row.avatarId !== null && !isStudentAvatarId(row.avatarId)) ||
    typeof row.level !== 'number' || !Number.isInteger(row.level) || row.level < 1 || row.level > 10)
    throw new Error('Invalid avatar response');
  return { avatarId: row.avatarId as StudentAvatarId | null, level: row.level };
}
export async function getStudentAvatar(): Promise<StudentAvatarState> {
  const { data, error } = await supabase.rpc('my_student_avatar');
  if (error) throw error;
  return parseStudentAvatar(data);
}
export async function setStudentAvatar(avatarId: StudentAvatarId): Promise<StudentAvatarState> {
  if (!isStudentAvatarId(avatarId)) throw new Error('AVATAR_INVALID');
  const { data, error } = await supabase.rpc('set_student_avatar', { p_avatar_id: avatarId });
  if (error) throw error;
  return parseStudentAvatar(data);
}

export function avatarErrorKey(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return code === 'PGRST202' || code === '42883' || code === '42P01' ? 'avatarUi.setupRequired' : 'avatarUi.failed';
}
