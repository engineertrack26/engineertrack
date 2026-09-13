import { advisorService } from './advisor';
import { groupService } from './group';

/** Independent reads: unavailable data is not a zero or an all-clear. */
export const advisorDashboardViewService = {
  async load(advisorId: string) {
    const [stats, groups, counts, followUp] = await Promise.allSettled([
      advisorService.getDashboardStats(advisorId),
      groupService.listMyGroups(advisorId),
      groupService.countMembersByGroup(),
      advisorService.getInactiveStudents(advisorId),
    ]);
    return { stats, groups, counts, followUp };
  },
};
