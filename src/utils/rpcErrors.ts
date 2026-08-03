export interface RpcErrorInfo {
  code: string;
  key: string;
  params?: Record<string, string>;
}

const ERROR_KEYS: Record<string, string> = {
  NOT_AUTHENTICATED: 'errors.notAuthenticated',
  ROLE_NOT_ALLOWED: 'errors.roleNotAllowed',
  INVALID_CODE: 'errors.invalidCode',
  EXPIRED_CODE: 'errors.expiredCode',
  INVALID_CODE_FORMAT: 'errors.invalidCodeFormat',
  CODE_SEGMENT_MISMATCH: 'errors.codeSegmentMismatch',
  INSTITUTION_MISMATCH: 'errors.institutionMismatch',
  EMAIL_DOMAIN_BLOCKED: 'errors.emailDomainBlocked',
  REPORT_RATE_LIMITED: 'errors.reportRateLimited',
  NOTE_TOO_LONG: 'errors.noteTooLong',
};

/**
 * Our RPCs raise stable codes, optionally with a `:detail` payload.
 * Anything else is a genuine database failure and gets the generic key.
 */
export function mapRpcError(message?: string): RpcErrorInfo {
  const raw = (message || '').trim();
  const [code, detail] = raw.split(':', 2);
  const key = ERROR_KEYS[code];

  if (!key) return { code: 'UNKNOWN', key: 'errors.unknown' };

  if (code === 'EMAIL_DOMAIN_BLOCKED' && detail) {
    return {
      code,
      key,
      params: { domains: detail.split(',').map((d) => d.trim()).join(', ') },
    };
  }

  return { code, key };
}
