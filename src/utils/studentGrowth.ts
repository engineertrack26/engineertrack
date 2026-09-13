import { LEVELS } from '@/types/gamification';

export function growthLevel(totalXp: number, currentLevel: number) {
  const current = LEVELS.find((level) => level.level === currentLevel) || LEVELS[0];
  const next = LEVELS.find((level) => level.level === current.level + 1);
  return { current, next, remaining: next ? Math.max(0, next.minXp - totalXp) : 0,
    progress: next ? Math.max(0, Math.min(1, (totalXp - current.minXp) / (next.minXp - current.minXp))) : 1 };
}

export function growthReason(reason: string): string {
  const known: Record<string, string> = {
    assignment_submitted: 'growthUi.submitted', assignment_approved: 'growthUi.approved',
  };
  return known[reason.split(':')[0]] || 'growthUi.xpUpdate';
}

export function leaderboardName(firstName: string, lastInitial: string, fallback: string): string {
  const first = firstName.trim();
  // Never expand the surname beyond the initial supplied by the server.
  const initial = Array.from(lastInitial.trim())[0]?.toLocaleUpperCase() || '';
  return [first, initial ? initial + '.' : ''].filter(Boolean).join(' ') || fallback;
}
