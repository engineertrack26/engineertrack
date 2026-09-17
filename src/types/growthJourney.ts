export interface GrowthJourneyMetrics {
  groupId: string | null;
  approvedTasks: number;
  availableTasks: number;
  improvedTasks: number;
  reflectiveDays: number;
  activeWeeks: number;
  competenciesReached: number;
  competenciesTotal: number;
  plannedWeeks: number;
  plannedDays: number;
  prepared: boolean;
  closed: boolean | null;
}
export type GrowthFamily = 'production' | 'feedback' | 'reflection' | 'competency' | 'consistency' | 'journey';
export interface GrowthAward {
  groupId: string;
  stageId: string;
  family: GrowthFamily;
  target: number;
  label: 'prepared' | 'reviewed' | 'closed' | null;
  earnedAt: string;
  checkedAt: string;
  verified: boolean;
  ruleVersion: number;
}
export interface GrowthJourneyData extends GrowthJourneyMetrics { awards: GrowthAward[] }
export interface GrowthStage {
  id: string;
  family: GrowthFamily;
  target: number;
  current: number;
  complete: boolean;
  available: boolean;
  optional: boolean;
  label?: 'prepared' | 'reviewed' | 'closed';
}
