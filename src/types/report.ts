/** One competency's standing across a group's active students. */
export interface CompetencyBreakdown {
  competencyId: string;
  competencyName: string;
  targetLevel: number;
  /** Active students in this group who have reached targetLevel. */
  studentsAtTarget: number;
}

/** One student's row in the group report. */
export interface StudentReportRow {
  id: string;
  name: string;
  /** From competencyCompletion(...).percent — level reached against target. */
  completionPercent: number;
  submitted: number;
  approved: number;
}

/** advisorService.getReportsData(groupId)'s return shape. `groupName` rides
 *  along on the payload rather than being looked up again by the screen, so
 *  the on-screen numbers and the CSV export can never name a different group
 *  than the one they were computed for. */
export interface GroupReportData {
  groupId: string;
  groupName: string;
  studentCount: number;
  /** averageCompletion across studentProgress. */
  averageCompletion: number;
  submitted: number;
  approved: number;
  needsRevision: number;
  competencyBreakdown: CompetencyBreakdown[];
  studentProgress: StudentReportRow[];
}
