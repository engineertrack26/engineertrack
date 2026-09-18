/** Stable IDs: persisted selections must not use array indexes or translated names. */
export const STUDENT_AVATAR_IDS = ['01', '02', '03', '04', '05', '06', '07', '08', '09'] as const;
export type StudentAvatarId = typeof STUDENT_AVATAR_IDS[number];
export type AvatarStage = 1 | 5 | 10;

export function isStudentAvatarId(value: unknown): value is StudentAvatarId {
  return typeof value === 'string' && (STUDENT_AVATAR_IDS as readonly string[]).includes(value);
}

/** Cosmetic mapping only; never writes XP or awards a level. */
export function avatarStage(level: number): AvatarStage {
  if (!Number.isFinite(level) || level < 1) return 1;
  return level >= 10 ? 10 : level >= 5 ? 5 : 1;
}
