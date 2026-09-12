import { mentorStudentService } from '../mentorStudents';
import { mentorService } from '../mentor';
import { supabase } from '../supabase';

jest.mock('../mentor', () => ({ mentorService: { getAssignedStudents: jest.fn() } }));
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

describe('mentor student data', () => {
  beforeEach(() => jest.resetAllMocks());
  it('loads only assigned students and preserves service errors', async () => {
    jest.mocked(mentorService.getAssignedStudents).mockResolvedValue([]);
    expect(await mentorStudentService.students('mentor')).toEqual([]);
    expect(mentorService.getAssignedStudents).toHaveBeenCalledWith('mentor');
    jest.mocked(mentorService.getAssignedStudents).mockRejectedValue(new Error('offline'));
    await expect(mentorStudentService.students('mentor')).rejects.toThrow('offline');
  });
  it('does not request pending counts without students', async () => {
    expect(await mentorStudentService.pendingCounts([])).toEqual({});
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it('counts multiple pages without signing evidence or requesting each student separately', async () => {
    const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(), range: jest.fn()
        .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, id) => ({ id, student_id: 's1' })), error: null })
        .mockResolvedValueOnce({ data: [{ id: 501, student_id: 's2' }], error: null }) };
    jest.mocked(supabase.from).mockReturnValue(query as never);
    expect(await mentorStudentService.pendingCounts(['s1', 's2'])).toEqual({ s1: 500, s2: 1 });
    expect(query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(query.in).toHaveBeenCalledWith('student_id', ['s1', 's2']);
    expect(query.eq).toHaveBeenCalledWith('status', 'submitted');
  });
  it('throws rather than returning zero for failed pending counts', async () => {
    const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(), range: jest.fn().mockResolvedValue({ data: null, error: new Error('offline') }) };
    jest.mocked(supabase.from).mockReturnValue(query as never);
    await expect(mentorStudentService.pendingCounts(['s1'])).rejects.toThrow('offline');
  });
  it('uses exact server counts scoped to the chosen student', async () => {
    const queries = [8, 4, 3].map(count => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count, error: null }).then(resolve) }));
    for (const query of queries) jest.mocked(supabase.from).mockReturnValueOnce(query as never);
    expect(await mentorStudentService.summary('s1')).toEqual({ total: 8, approved: 4, pending: 3 });
    for (const query of queries) {
      expect(query.select).toHaveBeenCalledWith('id, group_assignments!inner(id)', { count: 'exact', head: true });
      expect(query.eq).toHaveBeenCalledWith('student_id', 's1');
    }
    expect(queries[1].eq).toHaveBeenCalledWith('status', 'approved');
    expect(queries[2].eq).toHaveBeenCalledWith('status', 'submitted');
  });
});
