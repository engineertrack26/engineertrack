export interface TargetGroup { id: string; name: string; isArchived?: boolean }

/** Groups an advisor may post to: not archived, current group first, the
 *  rest in the order given. The current group is always included even if
 *  archived (the advisor is looking at it). */
export function postableGroups(groups: TargetGroup[], currentId: string): TargetGroup[] {
  const current = groups.find((g) => g.id === currentId);
  const rest = groups.filter((g) => g.id !== currentId && !g.isArchived);
  return current ? [current, ...rest] : rest;
}

export interface PostOutcome { groupId: string; name: string; ok: boolean }

/** Summarise a multi-group post for the user: all ok, or which failed. */
export function summarisePost(outcomes: PostOutcome[]): { ok: number; failed: string[] } {
  return {
    ok: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).map((o) => o.name),
  };
}
