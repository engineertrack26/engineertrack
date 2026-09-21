jest.mock('@/services/supabase', () => {
  const rows = { competencies: [{ id: 'c1', code: 'x', name: 'X', display_order: 1 }], competency_kpis: [] };
  const from = jest.fn((table: keyof typeof rows) => {
    const builder = { order: jest.fn(), then: undefined as unknown };
    builder.order.mockReturnValue(builder);
    // awaited by Promise.all: resolve to a PostgREST-shaped result
    (builder as unknown as { then: (r: (v: unknown) => void) => void }).then = (resolve) => resolve({ data: rows[table], error: null });
    return { select: () => builder };
  });
  return { supabase: { from } };
});
import { competencyService } from '@/services/competency';
import { supabase } from '@/services/supabase';

beforeEach(() => { competencyService.resetFrameworkCache(); jest.mocked(supabase.from).mockClear(); });

test('the framework is fetched once and shared', async () => {
  const [a, b] = await Promise.all([competencyService.listFramework(), competencyService.listFramework()]);
  await competencyService.listFramework();
  expect(a).toBe(b);
  expect(a.competencies[0]?.id).toBe('c1');
  expect(supabase.from).toHaveBeenCalledTimes(2); // competencies + competency_kpis, once
});

test('a failed fetch is not cached', async () => {
  jest.mocked(supabase.from).mockImplementationOnce(() => { throw new Error('offline'); });
  await expect(competencyService.listFramework()).rejects.toThrow('offline');
  await expect(competencyService.listFramework()).resolves.toBeTruthy();
});
