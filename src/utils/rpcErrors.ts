export interface RpcErrorInfo {
  code: string;
  key: string;
  /** Whatever followed the raw message's first ':', trimmed -- e.g. the task
   *  title in `NOT_IN_SCOPE: <title>` from publish_assignments. Undefined
   *  when the code was raised bare, which is still how most callers raise
   *  it (submit_assignment and review_assignment's NOT_IN_SCOPE carry no
   *  detail at all). A caller that wants the title interpolated into a
   *  sentence -- see errors.notInScopeTitled -- reads it from here rather
   *  than mapRpcError special-casing one code. */
  detail?: string;
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
  ALREADY_APPROVED: 'errors.alreadyApproved',
  STUDENT_LEFT_GROUP: 'errors.studentLeftGroup',
  ASSIGNMENT_LOCKED: 'errors.assignmentLocked',
  REFLECTION_REQUIRED: 'errors.reflectionRequired',
};

/**
 * Our RPCs raise stable codes, optionally with a `:detail` payload -- the
 * code is matched as a PREFIX up to the first colon, not the whole string,
 * so `NOT_IN_SCOPE: <title>` still resolves to the NOT_IN_SCOPE key rather
 * than falling through to errors.unknown and losing the title. Anything
 * that matches no known code is a genuine database failure and gets the
 * generic key.
 */
export function mapRpcError(message?: string): RpcErrorInfo {
  const raw = (message || '').trim();
  const sep = raw.indexOf(':');
  const code = sep === -1 ? raw : raw.slice(0, sep).trim();
  const detail = sep === -1 ? undefined : (raw.slice(sep + 1).trim() || undefined);
  const key = ERROR_KEYS[code];

  if (!key) return { code: 'UNKNOWN', key: 'errors.unknown' };

  return { code, key, detail };
}
