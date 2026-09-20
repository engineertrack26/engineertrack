import { authErrorKey } from '@/utils/authErrors';
import en from '@/i18n/locales/en.json';

describe('authErrorKey', () => {
  it('maps the leaked-password refusal to its own copy', () => {
    expect(authErrorKey({ code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.' }))
      .toBe('authUi.weakPassword');
  });
  it('maps the GoTrue codes the auth screens can hit', () => {
    expect(authErrorKey({ code: 'invalid_credentials' })).toBe('auth.invalidCredentials');
    expect(authErrorKey({ code: 'user_already_exists' })).toBe('authUi.emailTaken');
    expect(authErrorKey({ code: 'email_not_confirmed' })).toBe('authUi.emailNotConfirmed');
    expect(authErrorKey({ code: 'over_request_rate_limit' })).toBe('authUi.rateLimit');
  });
  it('never surfaces the raw message', () => {
    expect(authErrorKey(new Error('Auth session missing!'))).toBe('errors.unknown');
    expect(authErrorKey(null)).toBe('errors.unknown');
    expect(authErrorKey({ code: 'something_new' })).toBe('errors.unknown');
  });
  it('points at keys that exist in en', () => {
    const lookup = (key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
    for (const code of ['weak_password', 'invalid_credentials', 'user_already_exists', 'email_not_confirmed', 'over_request_rate_limit', 'nope']) {
      expect(typeof lookup(authErrorKey({ code }))).toBe('string');
    }
  });
});
