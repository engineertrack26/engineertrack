export const STUDENT_CODE_LENGTH = 6;

export type ParsedStudentCode =
  | { kind: 'valid'; studentCode: string }
  | { kind: 'invalid'; reason: 'EMPTY' | 'LENGTH' };

/** Uppercase, trim, and drop every whitespace character a paste may carry. */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * Validates the SHAPE of a student code only. Whether the code belongs to a
 * real, active student is decided server-side in link_student_by_code. Never
 * move that check here.
 */
export function parseStudentCode(input: string): ParsedStudentCode {
  const code = normalizeCode(input);
  if (!code) return { kind: 'invalid', reason: 'EMPTY' };
  if (code.length !== STUDENT_CODE_LENGTH) return { kind: 'invalid', reason: 'LENGTH' };
  return { kind: 'valid', studentCode: code };
}
