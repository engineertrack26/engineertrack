import { advisorDashboardViewService } from '../advisorDashboardView';
import { advisorService } from '../advisor';
import { groupService } from '../group';

jest.mock('../advisor', () => ({ advisorService: { getDashboardStats: jest.fn(), getInactiveStudents: jest.fn() } }));
jest.mock('../group', () => ({ groupService: { listMyGroups: jest.fn(), countMembersByGroup: jest.fn() } }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(advisorService.getDashboardStats).mockResolvedValue({ assignedCount: 2, avgCompletion: 40, progressResolvedCount: 1, students: [] });
  jest.mocked(advisorService.getInactiveStudents).mockResolvedValue([]);
  jest.mocked(groupService.listMyGroups).mockResolvedValue([]);
  jest.mocked(groupService.countMembersByGroup).mockResolvedValue({});
});

test('loads existing read APIs for the current advisor without feed or new RPC dependencies', async () => {
  const data = await advisorDashboardViewService.load('advisor');
  expect(advisorService.getDashboardStats).toHaveBeenCalledWith('advisor');
  expect(advisorService.getInactiveStudents).toHaveBeenCalledWith('advisor');
  expect(groupService.listMyGroups).toHaveBeenCalledWith('advisor');
  expect(groupService.countMembersByGroup).toHaveBeenCalledTimes(1);
  expect(data.stats).toMatchObject({ status: 'fulfilled', value: { assignedCount: 2, progressResolvedCount: 1 } });
});

test('failed follow-up data remains unavailable instead of claiming no students need attention', async () => {
  jest.mocked(advisorService.getInactiveStudents).mockRejectedValue(new Error('offline'));
  const data = await advisorDashboardViewService.load('advisor');
  expect(data.followUp.status).toBe('rejected');
  expect(data.groups).toEqual({ status: 'fulfilled', value: [] });
  expect(data.stats.status).toBe('fulfilled');
});

test('group counts failure does not remove navigable groups', async () => {
  jest.mocked(groupService.listMyGroups).mockResolvedValue([{
    id: 'g1', advisorId: 'advisor', name: 'Group', isArchived: false, joinCode: 'ABC', createdAt: '', updatedAt: '',
  }]);
  jest.mocked(groupService.countMembersByGroup).mockRejectedValue(new Error('counts'));
  const data = await advisorDashboardViewService.load('advisor');
  expect(data.counts.status).toBe('rejected');
  expect(data.groups).toMatchObject({ status: 'fulfilled', value: [{ id: 'g1' }] });
});

test('complete outage returns explicit failures in all sections, not fabricated zeroes', async () => {
  jest.mocked(groupService.listMyGroups).mockRejectedValue(new Error('offline'));
  jest.mocked(groupService.countMembersByGroup).mockRejectedValue(new Error('offline'));
  jest.mocked(advisorService.getDashboardStats).mockRejectedValue(new Error('offline'));
  jest.mocked(advisorService.getInactiveStudents).mockRejectedValue(new Error('offline'));
  const data = await advisorDashboardViewService.load('advisor');
  expect(Object.values(data).every((section) => section.status === 'rejected')).toBe(true);
});
