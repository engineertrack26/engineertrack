import { BADGES, LEVELS } from '@/types/gamification';

// Only these badges have an earning path in the current task workflow.
// Keep historical keys and awards intact; do not advertise retired goals.
export const ACTIVE_BADGE_KEYS = new Set(['first_task', 'streak_7', 'streak_30']);
export function growthBadges(earned: ReadonlySet<string>) {
  return {
    active: BADGES.filter(badge => ACTIVE_BADGE_KEYS.has(badge.key)),
    historical: BADGES.filter(badge => !ACTIVE_BADGE_KEYS.has(badge.key) && earned.has(badge.key)),
  };
}

export function growthLevel(totalXp: number, currentLevel: number) {
  const current = LEVELS.find((level) => level.level === currentLevel) || LEVELS[0];
  const next = LEVELS.find((level) => level.level === current.level + 1);
  return { current, next, remaining: next ? Math.max(0, next.minXp - totalXp) : 0,
    progress: next ? Math.max(0, Math.min(1, (totalXp - current.minXp) / (next.minXp - current.minXp))) : 1 };
}

export function growthReason(reason: string): string {
  const known: Record<string, string> = {
    assignment_submitted: 'growthUi.submitted', assignment_approved: 'growthUi.approved',
    assignment_photo: 'growthUi.photoBonus', daily_log_submit: 'growthUi.oldLogSubmit',
    log_approved: 'growthUi.oldLogApproved', photo_attached: 'growthUi.oldPhoto',
    self_assessment: 'growthUi.oldAssessment', poll_completed: 'growthUi.oldPoll',
    quiz_perfect_score: 'growthUi.oldQuiz',
  };
  return known[reason.split(':')[0]] || 'growthUi.xpUpdate';
}

export function leaderboardName(firstName: string, lastInitial: string, fallback: string): string {
  const first = firstName.trim();
  // Never expand the surname beyond the initial supplied by the server.
  const initial = Array.from(lastInitial.trim())[0]?.toLocaleUpperCase() || '';
  return [first, initial ? initial + '.' : ''].filter(Boolean).join(' ') || fallback;
}
