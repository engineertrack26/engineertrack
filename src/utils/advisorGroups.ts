import type { InternshipGroup } from '@/types/group';

export function filterAdvisorGroups(
  groups: InternshipGroup[], archived: boolean, search: string, locale: string,
): InternshipGroup[] {
  const query = search.trim().toLocaleLowerCase(locale);
  return groups.filter((g) => g.isArchived === archived &&
    (!query || (g.name + ' ' + (g.term ?? '')).toLocaleLowerCase(locale).includes(query)));
}

/** A requested group must belong to this advisor; never silently substitute another. */
export function selectAdvisorGroup(
  groups: { id: string; isArchived?: boolean }[],
  current: string | null,
  requested?: string,
): string | null {
  if (current && groups.some((g) => g.id === current)) return current;
  if (requested) return groups.some((g) => g.id === requested) ? requested : null;
  return (groups.find((g) => !g.isArchived) ?? groups[0])?.id ?? null;
}

export function groupCenterRoute(groupId: string) {
  return { pathname: '/(advisor)/groups' as const, params: { groupId } };
}

const workspacePaths = {
  'student-monitor': '/(advisor)/student-monitor',
  'group-assignments': '/(advisor)/group-assignments',
  'group-competencies': '/(advisor)/group-competencies',
  reports: '/(advisor)/reports',
  feed: '/(advisor)/feed',
} as const;

export function groupWorkspaceRoute(screen: keyof typeof workspacePaths, groupId: string) {
  return { pathname: workspacePaths[screen], params: { groupId, fromGroup: '1' } };
}
