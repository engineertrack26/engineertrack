import { supabase } from '../supabase';
import { getAdvisorGroupExport } from '../advisorGroupExport';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn() } }));
const snapshot = { exportVersion: 2, groupId: 'group-1', groupName: 'Group', term: null, archived: false,
  students: [], competencies: [], attendanceTotals: [], tasks: [], submissions: [], days: [] };
beforeEach(() => jest.clearAllMocks());

test('accepts the audience-aware report only for the requested group', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: snapshot, error: null } as never);
  await expect(getAdvisorGroupExport('group-1')).resolves.toEqual(snapshot);
  expect(supabase.rpc).toHaveBeenCalledWith('advisor_group_export', { p_group_id: 'group-1' });
  await expect(getAdvisorGroupExport('another-group')).rejects.toThrow('Invalid group export');
});

test('refuses an old RPC result rather than exporting incorrect target assignments', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: { ...snapshot, exportVersion: undefined }, error: null } as never);
  await expect(getAdvisorGroupExport('group-1')).rejects.toThrow('REPORT_UPDATE_REQUIRED');
});

test('refuses an invalid task audience', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: { ...snapshot, tasks: [{ audience: 'unknown' }] }, error: null } as never);
  await expect(getAdvisorGroupExport('group-1')).rejects.toThrow('Invalid group export');
});
