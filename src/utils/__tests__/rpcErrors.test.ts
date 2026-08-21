import { mapRpcError } from '@/utils/rpcErrors';

describe('mapRpcError', () => {
  it('maps a known bare code', () => {
    expect(mapRpcError('INVALID_CODE')).toEqual({
      code: 'INVALID_CODE',
      key: 'errors.invalidCode',
    });
  });

  it('falls back to a generic key for an unrecognised message', () => {
    expect(mapRpcError('some database explosion')).toEqual({
      code: 'UNKNOWN',
      key: 'errors.unknown',
    });
  });

  it('falls back for an undefined message', () => {
    expect(mapRpcError(undefined)).toEqual({ code: 'UNKNOWN', key: 'errors.unknown' });
  });

  it('ignores the Postgres error prefix Supabase prepends', () => {
    expect(mapRpcError('  INVALID_CODE_FORMAT  ')).toEqual({
      code: 'INVALID_CODE_FORMAT',
      key: 'errors.invalidCodeFormat',
    });
  });

  it('maps GROUP_ARCHIVED', () => {
    expect(mapRpcError('GROUP_ARCHIVED')).toEqual({
      code: 'GROUP_ARCHIVED',
      key: 'errors.groupArchived',
    });
  });

  it('maps GROUP_NOT_FOUND', () => {
    expect(mapRpcError('GROUP_NOT_FOUND')).toEqual({
      code: 'GROUP_NOT_FOUND',
      key: 'errors.groupNotFound',
    });
  });

  it('maps the assignment error codes', () => {
    expect(mapRpcError('ASSIGNMENT_NOT_FOUND').key).toBe('errors.assignmentNotFound');
    expect(mapRpcError('SUBMISSION_NOT_FOUND').key).toBe('errors.submissionNotFound');
    expect(mapRpcError('NOT_IN_SCOPE').key).toBe('errors.notInScope');
    expect(mapRpcError('ALREADY_APPROVED').key).toBe('errors.alreadyApproved');
    expect(mapRpcError('STUDENT_LEFT_GROUP').key).toBe('errors.studentLeftGroup');
    expect(mapRpcError('ASSIGNMENT_LOCKED').key).toBe('errors.assignmentLocked');
  });
});
