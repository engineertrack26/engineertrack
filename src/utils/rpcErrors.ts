export interface RpcErrorInfo {
  code: string;
  key: string;
}

const ERROR_KEYS: Record<string, string> = {
  NOT_AUTHENTICATED: 'errors.notAuthenticated',
  ROLE_NOT_ALLOWED: 'errors.roleNotAllowed',
  INVALID_CODE: 'errors.invalidCode',
  EXPIRED_CODE: 'errors.expiredCode',
  INVALID_CODE_FORMAT: 'errors.invalidCodeFormat',
  GROUP_ARCHIVED: 'errors.groupArchived',
  GROUP_NOT_FOUND: 'errors.groupNotFound',
  MEMBERSHIP_NOT_FOUND: 'errors.membershipNotFound',
  ASSIGNMENT_NOT_FOUND: 'errors.assignmentNotFound',
  SUBMISSION_NOT_FOUND: 'errors.submissionNotFound',
  NOT_IN_SCOPE: 'errors.notInScope',
};

/**
 * Our RPCs raise stable codes, optionally with a `:detail` payload.
 * Anything else is a genuine database failure and gets the generic key.
 */
export function mapRpcError(message?: string): RpcErrorInfo {
  const raw = (message || '').trim();
  const [code] = raw.split(':', 2);
  const key = ERROR_KEYS[code];

  if (!key) return { code: 'UNKNOWN', key: 'errors.unknown' };

  return { code, key };
}
