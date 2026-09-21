import { authService } from '@/services/auth';

jest.mock('@/services/supabase', () => ({ supabase: {} }));

describe('getProfileWithRetry', () => {
  afterEach(() => jest.restoreAllMocks());

  it('waits out the trigger race (PGRST116) and returns the profile', async () => {
    const spy = jest.spyOn(authService, 'getProfile')
      .mockRejectedValueOnce({ code: 'PGRST116', message: 'no rows' })
      .mockResolvedValueOnce({ id: 'u' } as Awaited<ReturnType<typeof authService.getProfile>>);
    await expect(authService.getProfileWithRetry('u', 3, 0)).resolves.toEqual({ id: 'u' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws any other failure at once', async () => {
    const spy = jest.spyOn(authService, 'getProfile').mockRejectedValue(new TypeError('Network request failed'));
    await expect(authService.getProfileWithRetry('u', 8, 0)).rejects.toThrow('Network request failed');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last retry', async () => {
    const spy = jest.spyOn(authService, 'getProfile').mockRejectedValue({ code: 'PGRST116' });
    await expect(authService.getProfileWithRetry('u', 3, 0)).rejects.toEqual({ code: 'PGRST116' });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
