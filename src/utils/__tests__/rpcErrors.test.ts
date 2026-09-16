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

  it('maps the internship closure error codes, PENDING_REVIEWS by its code prefix with the count as detail', () => {
    expect(mapRpcError('INTERNSHIP_CLOSED')).toEqual({ code: 'INTERNSHIP_CLOSED', key: 'errors.internshipClosed' });
    expect(mapRpcError('PENDING_REVIEWS: 3')).toEqual({ code: 'PENDING_REVIEWS', key: 'errors.pendingReviews', detail: '3' });
    expect(mapRpcError('ALREADY_CLOSED')).toEqual({ code: 'ALREADY_CLOSED', key: 'errors.alreadyClosed' });
    expect(mapRpcError('NOT_CLOSED')).toEqual({ code: 'NOT_CLOSED', key: 'errors.notClosed' });
    expect(mapRpcError('REASON_REQUIRED')).toEqual({ code: 'REASON_REQUIRED', key: 'errors.reasonRequired' });
    expect(mapRpcError('REPORT_FORBIDDEN')).toEqual({ code: 'REPORT_FORBIDDEN', key: 'errors.reportForbidden' });
    expect(mapRpcError('NO_REPORT')).toEqual({ code: 'NO_REPORT', key: 'errors.noReport' });
    expect(mapRpcError('STUDENT_NOT_IN_GROUP')).toEqual({ code: 'STUDENT_NOT_IN_GROUP', key: 'errors.studentNotInGroup' });
  });
});
