import { studentProfileViewService } from '../studentProfileView';
import { authService } from '../auth';
import { groupService } from '../group';
import { studentCodeService } from '../studentCode';

jest.mock('../auth', () => ({ authService: { getStudentProfile: jest.fn() } }));
jest.mock('../group', () => ({ groupService: { getMyGroup: jest.fn(), joinByCode: jest.fn() } }));
jest.mock('../studentCode', () => ({ studentCodeService: { getMyCodeDetails: jest.fn(), getLinkedUsers: jest.fn(), generateCode: jest.fn() } }));

describe('student profile presentation loader', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(authService.getStudentProfile).mockResolvedValue({ university: 'School' } as Awaited<ReturnType<typeof authService.getStudentProfile>>);
    jest.mocked(groupService.getMyGroup).mockResolvedValue({ id: 'g', name: 'Group', advisorName: 'Advisor', term: '2026' });
    jest.mocked(studentCodeService.getMyCodeDetails).mockResolvedValue({ code: 'ABC123' });
    jest.mocked(studentCodeService.getLinkedUsers).mockResolvedValue({ mentor: { id: 'm', firstName: 'M', lastName: 'N' }, advisor: null });
  });
  it('uses the existing read APIs and does not join groups or generate codes on load', async () => {
    const result = await studentProfileViewService.load('student');
    expect(authService.getStudentProfile).toHaveBeenCalledWith('student');
    expect(groupService.getMyGroup).toHaveBeenCalledWith('student');
    expect(studentCodeService.getLinkedUsers).toHaveBeenCalledWith('student');
    expect(studentCodeService.getMyCodeDetails).toHaveBeenCalledWith();
    expect(result.code).toEqual({ status: 'fulfilled', value: { code: 'ABC123' } });
    expect(studentCodeService.generateCode).not.toHaveBeenCalled();
    expect(groupService.joinByCode).not.toHaveBeenCalled();
  });
  it('does not erase internship, group or linked people when the code request fails', async () => {
    jest.mocked(studentCodeService.getMyCodeDetails).mockRejectedValue(new Error('offline'));
    const result = await studentProfileViewService.load('student');
    expect(result.code.status).toBe('rejected');
    expect(result.internship).toMatchObject({ status: 'fulfilled', value: { university: 'School' } });
    expect(result.group).toMatchObject({ status: 'fulfilled', value: { id: 'g' } });
    expect(result.linked).toMatchObject({ status: 'fulfilled', value: { mentor: { id: 'm' } } });
  });
  it('keeps missing data distinct from a failed request', async () => {
    jest.mocked(authService.getStudentProfile).mockResolvedValue(null);
    jest.mocked(groupService.getMyGroup).mockRejectedValue(new Error('offline'));
    jest.mocked(studentCodeService.getMyCodeDetails).mockResolvedValue(null);
    const result = await studentProfileViewService.load('student');
    expect(result.internship).toEqual({ status: 'fulfilled', value: null });
    expect(result.code).toEqual({ status: 'fulfilled', value: null });
    expect(result.group.status).toBe('rejected');
  });
});
