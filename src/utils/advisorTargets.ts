export type TargetSelection = Record<string, number>;

export function sameTargets(a: TargetSelection, b: TargetSelection): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => a[id] === b[id]);
}

export function toggleTarget(current: TargetSelection, id: string): TargetSelection {
  const next = { ...current };
  if (id in next) delete next[id];
  else next[id] = 2; // Preserve the existing default target level.
  return next;
}

export function validTargets(current: TargetSelection): boolean {
  return Object.keys(current).length > 0 && Object.values(current).every((level) =>
    Number.isInteger(level) && level >= 1 && level <= 4);
}
