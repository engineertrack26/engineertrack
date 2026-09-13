import { createClient } from '@supabase/supabase-js';
import { openPasswordRecovery } from '../passwordRecovery';
import { recoveryTokens, recoveryPasswordError } from '@/utils/passwordRecovery';
import { captureRecoveryLink, takeRecoveryLink } from '@/utils/recoveryLinkInbox';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
const setSession = jest.fn(), getUser = jest.fn(), updateUser = jest.fn(), signOut = jest.fn();
const url = 'engineertrack://reset-password#access_token=access&refresh_token=refresh&type=recovery';
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(createClient).mockReturnValue({ auth: { setSession, getUser, updateUser, signOut } } as never);
  setSession.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: { id: 'recovered', email: 'a@example.com' } }, error: null });
  updateUser.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
  takeRecoveryLink();
});
test('parses the configured native implicit recovery flow and Expo Go URLs', () => {
  expect(recoveryTokens(url)).toEqual({ access_token: 'access', refresh_token: 'refresh' });
  expect(recoveryTokens(url.replace('engineertrack://', 'exp://192.168.1.1:8081/--/'))).not.toBeNull();
});
test.each([url.replace('type=recovery', 'type=signup'), url.replace('refresh_token=refresh', ''),
  url.replace('reset-password', 'dashboard'), url.replace('engineertrack:', 'https:'), 'invalid',
  url + '&error_code=otp_expired'])('rejects invalid/non-recovery input %s', (value) => {
  expect(recoveryTokens(value)).toBeNull();
});
test('validates passwords without trimming or weakening the existing minimum', () => {
  expect(recoveryPasswordError('12345', '12345')).toBe('authUi.passwordHint');
  expect(recoveryPasswordError('123456', '654321')).toBe('auth.passwordMismatch');
  expect(recoveryPasswordError(' secret ', ' secret ')).toBeNull();
});
test('captures a warm-start link until the recovery screen mounts', () => {
  captureRecoveryLink(url); captureRecoveryLink('engineertrack://dashboard');
  expect(takeRecoveryLink()).toBe(url);
  expect(takeRecoveryLink()).toBeNull();
});
test('uses an isolated nonpersistent client and verifies the user before saving', async () => {
  const recovery = await openPasswordRecovery(url);
  expect(jest.mocked(createClient).mock.calls[0][2]?.auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  expect(recovery.email).toBe('a@example.com');
  await recovery.save('new-secret', 'new-secret');
  expect(getUser).toHaveBeenCalledTimes(2);
  expect(updateUser).toHaveBeenCalledWith({ password: 'new-secret' });
  expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  await expect(recovery.save('another', 'another')).rejects.toThrow('recoveryUi.invalid');
  expect(updateUser).toHaveBeenCalledTimes(1);
});
test('invalid links never create a client', async () => {
  await expect(openPasswordRecovery('invalid')).rejects.toThrow('recoveryUi.invalid');
  expect(createClient).not.toHaveBeenCalled();
});
test('expired sessions do not expose a form', async () => {
  setSession.mockResolvedValue({ error: { code: 'expired' } });
  await expect(openPasswordRecovery(url)).rejects.toThrow('recoveryUi.invalid');
  expect(updateUser).not.toHaveBeenCalled();
});
test('account mismatch before save prevents changing any password', async () => {
  const recovery = await openPasswordRecovery(url);
  getUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
  await expect(recovery.save('new-secret', 'new-secret')).rejects.toThrow('recoveryUi.invalid');
  expect(updateUser).not.toHaveBeenCalled();
});
test('server errors are sanitized and allow another attempt', async () => {
  const recovery = await openPasswordRecovery(url);
  updateUser.mockResolvedValueOnce({ error: { code: 'same_password', message: 'sensitive' } });
  await expect(recovery.save('new-secret', 'new-secret')).rejects.toThrow('recoveryUi.different');
  await expect(recovery.save('different', 'different')).resolves.toBeUndefined();
});
test('invalid confirmation makes no password update', async () => {
  const recovery = await openPasswordRecovery(url);
  await expect(recovery.save('new-secret', 'wrong')).rejects.toThrow('auth.passwordMismatch');
  expect(updateUser).not.toHaveBeenCalled();
});
