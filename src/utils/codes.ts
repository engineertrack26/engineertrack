export const INSTITUTION_CODE_LENGTH = 8;
export const DEPARTMENT_CODE_LENGTH = 6;
export const STUDENT_CODE_LENGTH = 6;

export type ParsedStudentCode =
  | { kind: 'short'; studentCode: string }
  | {
      kind: 'composite';
      institutionCode: string;
      departmentCode: string;
      studentCode: string;
    }
  | { kind: 'invalid'; reason: 'EMPTY' | 'SEGMENT_COUNT' | 'SEGMENT_LENGTH' };

/** Uppercase, trim, and drop every whitespace character a paste may carry. */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * Validates the SHAPE of a student code only — segment count and lengths.
 * Whether segment 1 really is this student's institution is decided
 * server-side in link_student_by_code. Never move that check here.
 */
export function parseStudentCode(input: string): ParsedStudentCode {
  const code = normalizeCode(input);
  if (!code) return { kind: 'invalid', reason: 'EMPTY' };

  if (!code.includes('_')) {
    if (code.length !== STUDENT_CODE_LENGTH) {
      return { kind: 'invalid', reason: 'SEGMENT_LENGTH' };
    }
    return { kind: 'short', studentCode: code };
  }

  const segments = code.split('_');
  if (segments.length !== 3) {
    return { kind: 'invalid', reason: 'SEGMENT_COUNT' };
  }

  const [institutionCode, departmentCode, studentCode] = segments;
  if (
    institutionCode.length !== INSTITUTION_CODE_LENGTH ||
    departmentCode.length !== DEPARTMENT_CODE_LENGTH ||
    studentCode.length !== STUDENT_CODE_LENGTH
  ) {
    return { kind: 'invalid', reason: 'SEGMENT_LENGTH' };
  }

  return { kind: 'composite', institutionCode, departmentCode, studentCode };
}

/** Null until the student has joined a department — there is no composite before that. */
export function buildCompositeStudentCode(
  institutionCode?: string | null,
  departmentCode?: string | null,
  studentCode?: string | null,
): string | null {
  if (!institutionCode || !departmentCode || !studentCode) return null;
  return `${institutionCode}_${departmentCode}_${studentCode}`.toUpperCase();
}
