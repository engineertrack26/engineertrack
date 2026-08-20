export interface Competency {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
}

export interface CompetencyKpi {
  id: string;
  competencyId: string;
  level: number;
  kpiIndex: number;
  statement: string;
}

/** `currentLevel` is 0 until the first level is complete. */
export interface CompetencyProgress {
  competencyId: string;
  code: string;
  name: string;
  currentLevel: number;
  targetLevel: number;
}

export interface WorkingKpi {
  kpiId: string;
  competencyId: string;
  competencyName: string;
  level: number;
  kpiIndex: number;
  statement: string;
}

export interface GroupCompetencyTarget {
  competencyId: string;
  targetLevel: number;
}
