import { groupService } from './group';
import { assignmentService } from './assignments';
import { competencyService } from './competency';

/** Presentation-only reads; no changes to group, membership or publishing rules. */
export const advisorGroupViewService = {
  async load(advisorId: string, groupId: string) {
    const groups = await groupService.listMyGroups(advisorId);
    const group = groups.find((g) => g.id === groupId);
    if (!group) return null;
    const [members, assignments, targets] = await Promise.allSettled([
      groupService.listMembers(groupId),
      assignmentService.listGroupAssignments(groupId),
      competencyService.getGroupTargets(groupId),
    ]);
    return { group, groups, members, assignments, targets };
  },
};
