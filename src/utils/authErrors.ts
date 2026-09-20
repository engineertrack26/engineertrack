/**
 * Maps a GoTrue (Supabase Auth) failure to a locale key. Auth errors carry a
 * stable `code` (`weak_password`, `invalid_credentials`, …); the message is
 * English prose and is never shown. Anything unrecognised is `errors.unknown`.
 * The profile's change-password flow has its own mapper (`profileError`)
 * because its copy is phrased for a signed-in user.
 */
const AUTH_ERROR_KEYS: Record<string, string> = {
  // Leaked-password protection and the password policy (sign-up, reset).
  weak_password: 'authUi.weakPassword',
  invalid_credentials: 'auth.invalidCredentials',
  user_already_exists: 'authUi.emailTaken',
  email_exists: 'authUi.emailTaken',
  email_not_confirmed: 'authUi.emailNotConfirmed',
  over_request_rate_limit: 'authUi.rateLimit',
  over_email_send_rate_limit: 'authUi.rateLimit',
};

export function authErrorKey(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  return AUTH_ERROR_KEYS[code] ?? 'errors.unknown';
}
