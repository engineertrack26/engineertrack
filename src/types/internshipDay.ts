export type Attendance = 'pending' | 'present' | 'partial' | 'excused' | 'absent';
export interface InternshipPerson {
  id: string; name: string; company: string; startDate: string; endDate: string; mentorId: string | null;
}
export interface InternshipDay {
  id: string; student_id: string; placement_id: string; day_date: string; company: string; timezone: string;
  reported_at: string; check_in_at: string | null; report_reason: string;
  attendance: Attendance; attendance_by: string | null; attendance_at: string | null; attendance_note: string;
  correction_requested: boolean; experience: string; learning: string; next_step: string;
  support_level: number | null; log_status: 'draft' | 'submitted'; submitted_at: string | null; version: number;
  task_id: string | null; task_title: string | null; competency_name: string | null; attachment: DayAttachment | null;
}
export interface DayEvent {
  id: string; actor_name: string; event_type: 'created' | 'log_saved' | 'log_submitted' | 'attendance' | 'feedback' | 'correction';
  note: string; created_at: string; previous_value: Record<string, unknown> | null; next_value: Record<string, unknown> | null;
}
export interface DayAttachment { path: string; name: string }
export interface DayTask { id: string; title: string; competency: string }
export interface DayLogForm { experience: string; learning: string; nextStep: string; support: number | null; reason: string; taskId: string | null; attachment: DayAttachment | null }
