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
  /** From internship_group_attendance; null when the internship-days module
   *  is not installed on this database, so the rest of the report still works. */
  attendance: GroupAttendance | null;
}

/** One student's attendance totals across their placements in the group. */
export interface AttendanceStudentRow {
  id: string;
  name: string;
  company: string;
  mentor: string;
  present: number;
  partial: number;
  excused: number;
  absent: number;
  pending: number;
  corrections: number;
  submittedLogs: number;
  /** Days recorded in the app, whatever their attendance state. */
  recorded: number;
  /** Weekdays across the student's placements in the group (no holiday calendar). */
  expectedDays: number;
  /** The same, stopped at today in the placement's timezone. */
  expectedSoFar: number;
  /** expectedSoFar minus days recorded in the app, floored at 0. Not "absent":
   *  a day nobody recorded is unknown, and the report says so. */
  unrecorded: number;
}

/** One internship day as the CSV records it. No log content -- status only. */
export interface AttendanceDayRow {
  studentId: string;
  name: string;
  /** YYYY-MM-DD in the placement's timezone. */
  date: string;
  attendance: 'pending' | 'present' | 'partial' | 'excused' | 'absent';
  /** The student opened the day on the day itself (server-stamped). */
  checkedIn: boolean;
  checkInAt: string | null;
  decidedBy: string;
  decidedAt: string | null;
  correctionRequested: boolean;
  logStatus: 'draft' | 'submitted';
}

export interface GroupAttendance {
  students: AttendanceStudentRow[];
  days: AttendanceDayRow[];
}
