import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { mentorProfileService } from '../mentorProfile';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('../auth', () => ({ authService: { updateProfile: jest.fn() } }));

const login = jest.fn(), update = jest.fn(), logout = jest.fn();
const session = (id: string) => ({ data: { session: { user: { id } } }, error: null });
describe('mentor password changes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(supabase.auth.getSession).mockResolvedValue(session('u1') as never);
    jest.mocked(createClient).mockReturnValue({ auth: { signInWithPassword: login, updateUser: update, signOut: logout } } as never);
    login.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    update.mockResolvedValue({ error: null });
    logout.mockResolvedValue({ error: null });
  });
  it('rejects invalid forms before making auth requests', async () => {
    await expect(mentorProfileService.changePassword('u1', 'a@example.com', '', 'abcdefgh', 'abcdefgh')).rejects.toThrow('mentorProfile.currentRequired');
    expect(createClient).not.toHaveBeenCalled();
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });
  it('verifies the current password on an isolated nonpersistent client before updating', async () => {
    await mentorProfileService.changePassword('u1', 'a@example.com', 'old-secret', 'new-secret', 'new-secret');
    expect(jest.mocked(createClient).mock.calls[0][2]).toEqual({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(login).toHaveBeenCalledWith({ email: 'a@example.com', password: 'old-secret' });
    expect(update).toHaveBeenCalledWith({ password: 'new-secret' });
    expect(logout).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('does not update with the wrong current password', async () => {
    login.mockResolvedValue({ data: { user: null }, error: { code: 'invalid_credentials' } });
    await expect(mentorProfileService.changePassword('u1', 'a@example.com', 'wrong', 'abcdefgh', 'abcdefgh')).rejects.toEqual({ code: 'invalid_credentials' });
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects another account returned by reauthentication', async () => {
    login.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null });
    await expect(mentorProfileService.changePassword('u1', 'a@example.com', 'old', 'abcdefgh', 'abcdefgh')).rejects.toThrow('Account mismatch');
    expect(update).not.toHaveBeenCalled();
  });
  it('does not update if the main app switches account during reauthentication', async () => {
    jest.mocked(supabase.auth.getSession).mockResolvedValueOnce(session('u1') as never).mockResolvedValueOnce(session('u2') as never);
    await expect(mentorProfileService.changePassword('u1', 'a@example.com', 'old', 'abcdefgh', 'abcdefgh')).rejects.toThrow('Session changed');
    expect(update).not.toHaveBeenCalled();
  });
  it('propagates password policy errors and still clears the temporary session', async () => {
    update.mockResolvedValue({ error: { code: 'weak_password' } });
    await expect(mentorProfileService.changePassword('u1', 'a@example.com', 'old', 'abcdefgh', 'abcdefgh')).rejects.toEqual({ code: 'weak_password' });
    expect(logout).toHaveBeenCalledWith({ scope: 'local' });
  });
});
