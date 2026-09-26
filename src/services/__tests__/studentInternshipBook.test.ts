import { supabase } from '../supabase';
import { getMyInternshipBook } from '../studentInternshipBook';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn() } }));
const minimal = { student: { id: 'student-1', name: 'İpek' }, groups: [], placements: [],
  days: [], tasks: [], competencies: [] };
beforeEach(() => jest.clearAllMocks());

test('loads only the current student book through the owner-only RPC', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: minimal, error: null } as never);
  await expect(getMyInternshipBook('student-1')).resolves.toEqual(minimal);
  expect(supabase.rpc).toHaveBeenCalledWith('my_internship_book');
});

test('rejects switched-account or malformed results', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: minimal, error: null } as never);
  await expect(getMyInternshipBook('student-2')).rejects.toThrow('Invalid internship book');
  jest.mocked(supabase.rpc).mockResolvedValue({ data: { student: minimal.student }, error: null } as never);
  await expect(getMyInternshipBook('student-1')).rejects.toThrow('Invalid internship book');
});

test('surfaces the RPC error instead of showing an empty book', async () => {
  const error = new Error('BOOK_FORBIDDEN');
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error } as never);
  await expect(getMyInternshipBook('student-1')).rejects.toBe(error);
});
