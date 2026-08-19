import { normalizeCode, parseStudentCode, STUDENT_CODE_LENGTH } from '@/utils/codes';

describe('normalizeCode', () => {
  it('uppercases and strips every whitespace character', () => {
    expect(normalizeCode(' h94 fqv \n')).toBe('H94FQV');
  });

  it('returns an empty string for whitespace only', () => {
    expect(normalizeCode('   ')).toBe('');
  });
});

describe('parseStudentCode', () => {
  it('accepts a six-character code', () => {
    expect(parseStudentCode('H94FQV')).toEqual({ kind: 'valid', studentCode: 'H94FQV' });
  });

  it('normalises before validating', () => {
    expect(parseStudentCode(' h94 fqv ')).toEqual({ kind: 'valid', studentCode: 'H94FQV' });
  });

  it('rejects an empty code', () => {
    expect(parseStudentCode('')).toEqual({ kind: 'invalid', reason: 'EMPTY' });
  });

  it('rejects a short code', () => {
    expect(parseStudentCode('H94FQ')).toEqual({ kind: 'invalid', reason: 'LENGTH' });
  });

  it('rejects a long code', () => {
    expect(parseStudentCode('H94FQVX')).toEqual({ kind: 'invalid', reason: 'LENGTH' });
  });

  it('rejects a composite code, which no longer exists', () => {
    // The old INSTITUTION_DEPARTMENT_STUDENT format. Two of its three
    // segments were deleted with the institution model; anything still
    // carrying underscores is stale input, not a code.
    expect(parseStudentCode('7BW8HH29_H94FQV_ABC123')).toEqual({
      kind: 'invalid',
      reason: 'LENGTH',
    });
  });

  it('exposes the code length it enforces', () => {
    expect(STUDENT_CODE_LENGTH).toBe(6);
  });
});
