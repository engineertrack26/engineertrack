export interface Badge {
  id: string;
  key: string;
  nameKey: string;
  descriptionKey: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold';
  requirement: number;
  category: 'consistency' | 'quality' | 'engagement' | 'milestone';
}

export interface Level {
  level: number;
  nameKey: string;
  minXp: number;
  maxXp: number;
}

// XP journey stages, not professional titles or competency assessments.
// Translation keys remain stable for existing consumers. Thresholds mirror
// calculate_level in docs/gamification-server-side-migration.sql.
export const LEVELS: Level[] = [
  { level: 1, nameKey: 'levels.beginner', minXp: 0, maxXp: 100 },
  { level: 2, nameKey: 'levels.novice', minXp: 100, maxXp: 300 },
  { level: 3, nameKey: 'levels.apprentice', minXp: 300, maxXp: 600 },
  { level: 4, nameKey: 'levels.journeyman', minXp: 600, maxXp: 1000 },
  { level: 5, nameKey: 'levels.expert', minXp: 1000, maxXp: 1500 },
  { level: 6, nameKey: 'levels.master', minXp: 1500, maxXp: 2100 },
  { level: 7, nameKey: 'levels.grandmaster', minXp: 2100, maxXp: 2800 },
  { level: 8, nameKey: 'levels.legend', minXp: 2800, maxXp: 3600 },
  { level: 9, nameKey: 'levels.mythic', minXp: 3600, maxXp: 4500 },
  { level: 10, nameKey: 'levels.transcendent', minXp: 4500, maxXp: Infinity },
];

export const BADGES: Badge[] = [
  {
    id: 'first_log',
    key: 'first_log',
    nameKey: 'badges.firstLog.name',
    descriptionKey: 'badges.firstLog.description',
    icon: 'pencil',
    tier: 'bronze',
    requirement: 1,
    category: 'milestone',
  },
  {
    id: 'first_task',
    key: 'first_task',
    nameKey: 'growthUi.firstTaskName',
    descriptionKey: 'growthUi.firstTaskRule',
    icon: 'pencil',
    tier: 'bronze',
    requirement: 1,
    category: 'milestone',
  },
  {
    id: 'streak_7',
    key: 'streak_7',
    nameKey: 'growthUi.weekBadge',
    descriptionKey: 'growthUi.weekRule',
    icon: 'fire',
    tier: 'bronze',
    requirement: 4,
    category: 'consistency',
  },
  {
    id: 'streak_30',
    key: 'streak_30',
    nameKey: 'growthUi.weekBadge',
    descriptionKey: 'growthUi.weekRule',
    icon: 'fire',
    tier: 'silver',
    requirement: 8,
    category: 'consistency',
  },
  {
    id: 'quality_10',
    key: 'quality_10',
    nameKey: 'badges.quality10.name',
    descriptionKey: 'badges.quality10.description',
    icon: 'star',
    tier: 'silver',
    requirement: 10,
    category: 'quality',
  },
  {
    id: 'all_approved',
    key: 'all_approved',
    nameKey: 'badges.allApproved.name',
    descriptionKey: 'badges.allApproved.description',
    icon: 'checkmark-circle',
    tier: 'gold',
    requirement: 1,
    category: 'milestone',
  },
  {
    id: 'quiz_master',
    key: 'quiz_master',
    nameKey: 'growthUi.oldPoll',
    descriptionKey: 'growthUi.historicalHint',
    icon: 'school',
    tier: 'silver',
    requirement: 5,
    category: 'engagement',
  },
];

// Legacy reference only, not an executable reward policy. Current task rewards
// live in submit_assignment and award_assignment_xp on the server. Entries such
// as revisionPenalty/documentAttached must not be advertised as active rules.
export const POINT_VALUES = {
  dailyLogSubmit: 10,
  logApproved: 20,
  selfAssessment: 5,
  photoAttached: 3,
  documentAttached: 3,
  streakBonus: 5,
  qualityBonus: 15,
  revisionPenalty: -5,
  pollCompleted: 15,
  quizPerfectScore: 25,
} as const;
