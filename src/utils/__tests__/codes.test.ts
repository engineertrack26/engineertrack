import {
  normalizeCode,
  parseStudentCode,
  buildCompositeStudentCode,
} from '@/utils/codes';

describe('normalizeCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeCode(' h94fqv ')).toBe('H94FQV');
  });

  it('strips internal whitespace left by paste', () => {
    expect(normalizeCode('7BW8HH29 _ CH96JV _ H94FQV')).toBe('7BW8HH29_CH96JV_H94FQV');
  });
});

describe('parseStudentCode', () => {
  it('treats a bare 6-character code as a short code', () => {
    expect(parseStudentCode('H94FQV')).toEqual({
      kind: 'short',
      studentCode: 'H94FQV',
    });
  });

  it('parses a full composite code', () => {
    expect(parseStudentCode('7BW8HH29_CH96JV_H94FQV')).toEqual({
      kind: 'composite',
      institutionCode: '7BW8HH29',
      departmentCode: 'CH96JV',
      studentCode: 'H94FQV',
    });
  });

  it('normalises before parsing', () => {
    expect(parseStudentCode(' 7bw8hh29_ch96jv_h94fqv ')).toEqual({
      kind: 'composite',
      institutionCode: '7BW8HH29',
      departmentCode: 'CH96JV',
      studentCode: 'H94FQV',
    });
  });

  it('rejects an empty input', () => {
    expect(parseStudentCode('   ')).toEqual({ kind: 'invalid', reason: 'EMPTY' });
  });

  it('rejects a two-segment code', () => {
    expect(parseStudentCode('7BW8HH29_H94FQV')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_COUNT',
    });
  });

  it('rejects a four-segment code', () => {
    expect(parseStudentCode('A_B_C_D')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_COUNT',
    });
  });

  it('rejects composite segments of the wrong length', () => {
    expect(parseStudentCode('7BW8HH2_CH96JV_H94FQV')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_LENGTH',
    });
  });

  it('rejects a short code of the wrong length', () => {
    expect(parseStudentCode('H94FQ')).toEqual({
      kind: 'invalid',
      reason: 'SEGMENT_LENGTH',
    });
  });
});

describe('buildCompositeStudentCode', () => {
  it('joins all three parts', () => {
    expect(buildCompositeStudentCode('7BW8HH29', 'CH96JV', 'H94FQV')).toBe(
      '7BW8HH29_CH96JV_H94FQV',
    );
  });

  it('returns null when the student has not joined a department', () => {
    expect(buildCompositeStudentCode(null, null, 'H94FQV')).toBeNull();
    expect(buildCompositeStudentCode('7BW8HH29', null, 'H94FQV')).toBeNull();
    expect(buildCompositeStudentCode('7BW8HH29', 'CH96JV', null)).toBeNull();
  });
});
