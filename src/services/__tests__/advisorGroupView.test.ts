import { advisorGroupViewService } from '../advisorGroupView';
import { groupService } from '../group';
import { assignmentService } from '../assignments';
import { competencyService } from '../competency';

jest.mock('../group', () => ({ groupService: { listMyGroups: jest.fn(), listMembers: jest.fn(), createGroup: jest.fn(), setArchived: jest.fn() } }));
jest.mock('../assignments', () => ({ assignmentService: { listGroupAssignments: jest.fn() } }));
jest.mock('../competency', () => ({ competencyService: { getGroupTargets: jest.fn() } }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(groupService.listMyGroups).mockResolvedValue([{
    id: 'g', advisorId: 'advisor', name: 'Test group', joinCode: 'CODE', isArchived: false, createdAt: '', updatedAt: '',
  }]);
  jest.mocked(groupService.listMembers).mockResolvedValue([]);
  jest.mocked(assignmentService.listGroupAssignments).mockResolvedValue([]);
  jest.mocked(competencyService.getGroupTargets).mockResolvedValue([]);
});

it('loads only the selected owned group using read APIs', async () => {
  const result = await advisorGroupViewService.load('advisor', 'g');
  expect(groupService.listMyGroups).toHaveBeenCalledWith('advisor');
  expect(groupService.listMembers).toHaveBeenCalledWith('g');
  expect(assignmentService.listGroupAssignments).toHaveBeenCalledWith('g');
  expect(competencyService.getGroupTargets).toHaveBeenCalledWith('g');
  expect(result?.group.id).toBe('g');
  expect(groupService.createGroup).not.toHaveBeenCalled();
  expect(groupService.setArchived).not.toHaveBeenCalled();
});

it('does not query details for a missing or inaccessible group', async () => {
  expect(await advisorGroupViewService.load('advisor', 'other')).toBeNull();
  expect(groupService.listMembers).not.toHaveBeenCalled();
  expect(assignmentService.listGroupAssignments).not.toHaveBeenCalled();
});

it('keeps partial failures distinct from zero members or zero tasks', async () => {
  jest.mocked(groupService.listMembers).mockRejectedValue(new Error('offline'));
  const result = await advisorGroupViewService.load('advisor', 'g');
  expect(result?.members.status).toBe('rejected');
  expect(result?.assignments).toEqual({ status: 'fulfilled', value: [] });
  expect(result?.targets).toEqual({ status: 'fulfilled', value: [] });
});

it('propagates a group-list failure instead of claiming that the group does not exist', async () => {
  jest.mocked(groupService.listMyGroups).mockRejectedValue(new Error('offline'));
  await expect(advisorGroupViewService.load('advisor', 'g')).rejects.toThrow('offline');
  expect(groupService.listMembers).not.toHaveBeenCalled();
});
