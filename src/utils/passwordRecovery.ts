import { PASSWORD_MIN_LENGTH } from '@/utils/passwordPolicy';

export function recoveryTokens(url: string) {
  try {
    const parsed = new URL(url);
    const path = `${parsed.hostname}${parsed.pathname}`;
    if (!['engineertrack:', 'exp:', 'exps:'].includes(parsed.protocol)
      || !/(^|\/)reset-password\/?$/.test(path)) return null;
    const params = new URLSearchParams(parsed.hash.slice(1));
    if (params.get('type') !== 'recovery' || params.has('error') || params.has('error_code')) return null;
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    return access_token && refresh_token ? { access_token, refresh_token } : null;
  } catch { return null; }
}

export function recoveryPasswordError(password: string, confirmation: string) {
  if (password.length < PASSWORD_MIN_LENGTH) return 'authUi.passwordHint';
  if (password !== confirmation) return 'auth.passwordMismatch';
  return null;
}
