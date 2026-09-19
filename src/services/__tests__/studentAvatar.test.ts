import { supabase } from '../supabase';
import { authService } from '../auth';
import { avatarErrorKey, getAdvisorStudentAvatars, getStudentAvatar, parseStudentAvatar, setStudentAvatar } from '../studentAvatar';
import { avatarCopy } from '@/i18n/avatarCopy';
jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn(), auth: { signUp: jest.fn() } } }));

beforeEach(() => { jest.clearAllMocks(); });

test('advisor avatar batch uses group scope and server level without per-student requests', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: [
    { studentId: 'a', avatarId: '09', level: 6 }, { studentId: 'b', avatarId: '02', level: 10 },
  ], error: null } as never);
  expect(await getAdvisorStudentAvatars('group')).toEqual({ a: { avatarId: '09', level: 6 }, b: { avatarId: '02', level: 10 } });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('advisor_student_avatars', { p_group_id: 'group' });
});

test('advisor overview uses server-authorized scope and accepts no selections', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as never);
  expect(await getAdvisorStudentAvatars()).toEqual({});
  expect(supabase.rpc).toHaveBeenCalledWith('advisor_student_avatars', { p_group_id: null });
});

test.each([null, {}, [{ studentId: '', avatarId: '01', level: 1 }],
  [{ studentId: 'a', avatarId: '99', level: 1 }], [{ studentId: 'a', avatarId: '01', level: 11 }]])(
  'advisor avatars reject malformed responses %p', async (data) => {
    jest.mocked(supabase.rpc).mockResolvedValue({ data, error: null } as never);
    await expect(getAdvisorStudentAvatars()).rejects.toThrow();
  },
);

test('advisor avatar errors remain failures rather than fabricated avatar choices', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: '42501' } } as never);
  await expect(getAdvisorStudentAvatars()).rejects.toEqual({ code: '42501' });
});
test('reads only current account with no target ID parameter', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: { avatarId: null, level: 1 }, error: null } as never);
  expect(await getStudentAvatar()).toEqual({ avatarId: null, level: 1 });
  expect(supabase.rpc).toHaveBeenCalledWith('my_student_avatar');
});
test('save sends only a character, never XP or an appearance stage', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: { avatarId: '09', level: 6 }, error: null } as never);
  expect(await setStudentAvatar('09')).toEqual({ avatarId: '09', level: 6 });
  expect(supabase.rpc).toHaveBeenCalledWith('set_student_avatar', { p_avatar_id: '09' });
});
test('invalid choice never reaches the server', async () => {
  await expect(setStudentAvatar('99' as never)).rejects.toThrow('AVATAR_INVALID');
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('missing migration remains an explicit error, not a default saved avatar', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: 'PGRST202' } } as never);
  await expect(getStudentAvatar()).rejects.toEqual({ code: 'PGRST202' });
  expect(avatarErrorKey({ code: 'PGRST202' })).toBe('avatarUi.setupRequired');
  expect(avatarErrorKey(Error('offline'))).toBe('avatarUi.failed');
});
test.each([null, {}, { avatarId: '10', level: 1 }, { avatarId: '01', level: 0 },
  { avatarId: '01', level: 11 }, { avatarId: '01', level: '5' }, { avatarId: '01', level: NaN }])('rejects malformed response %p', data => {
  expect(() => parseStudentAvatar(data)).toThrow();
});
test.each(Object.entries(avatarCopy))('%s has complete translated avatar copy and placeholders', (_language, copy) => {
  expect(Object.keys(copy).sort()).toEqual(Object.keys(avatarCopy.en).sort());
  for (const key of Object.keys(avatarCopy.en) as (keyof typeof avatarCopy.en)[]) {
    expect(copy[key].trim()).not.toBe('');
    expect((copy[key].match(/\{\{\w+\}\}/g) || []).sort()).toEqual((avatarCopy.en[key].match(/\{\{\w+\}\}/g) || []).sort());
  }
});
const signup = { email: 'test@example.com', password: 'test-only', firstName: 'Test', lastName: 'Student', language: 'tr' as const };
test('registration captures choice in metadata without requiring a confirmed session', async () => {
  jest.mocked(supabase.auth.signUp).mockResolvedValue({ data: { session: null, user: null }, error: null });
  await authService.signUp({ ...signup, role: 'student', avatarId: '03' });
  expect(supabase.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: { data: expect.objectContaining({ student_avatar_id: '03' }) } }));
});
test('staff registration never stores a student avatar', async () => {
  jest.mocked(supabase.auth.signUp).mockResolvedValue({ data: { session: null, user: null }, error: null });
  await authService.signUp({ ...signup, role: 'mentor', avatarId: '03' });
  expect(jest.mocked(supabase.auth.signUp).mock.calls[0][0]).toEqual(expect.objectContaining({
    options: { data: { first_name: 'Test', last_name: 'Student', language: 'tr', role: 'mentor' } },
  }));
});
