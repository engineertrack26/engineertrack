import { authService } from './auth';
import { groupService } from './group';
import { studentCodeService } from './studentCode';

// Read-only presentation loader. Keep existing membership and code RPCs intact;
// one failed section must not erase successful results in another section.
export const studentProfileViewService = {
  async load(userId: string) {
    const [internship, group, code, linked] = await Promise.allSettled([
      authService.getStudentProfile(userId), groupService.getMyGroup(userId),
      studentCodeService.getMyCodeDetails(), studentCodeService.getLinkedUsers(userId),
    ]);
    return { internship, group, code, linked };
  },
};
