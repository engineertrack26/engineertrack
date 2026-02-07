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
    id: 'streak_7',
    key: 'streak_7',
    nameKey: 'badges.streak7.name',
    descriptionKey: 'badges.streak7.description',
    icon: 'fire',
    tier: 'bronze',
    requirement: 7,
    category: 'consistency',
  },
  {
    id: 'streak_30',
    key: 'streak_30',
    nameKey: 'badges.streak30.name',
    descriptionKey: 'badges.streak30.description',
    icon: 'fire',
    tier: 'silver',
    requirement: 30,
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
];

export const POINT_VALUES = {
  dailyLogSubmit: 10,
  logApproved: 20,
  selfAssessment: 5,
  photoAttached: 3,
  documentAttached: 3,
  streakBonus: 5,
  qualityBonus: 15,
  revisionPenalty: -5,
} as const;
