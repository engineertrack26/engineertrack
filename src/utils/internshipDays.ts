import { internshipDateString, parseInternshipDate } from './internshipForm';
import type { DayLogForm, InternshipDay } from '@/types/internshipDay';
export function dayWeek(value: string): string[] {
  const date = parseInternshipDate(value);
  if (!date) return [];
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(date); d.setDate(d.getDate() + i); return internshipDateString(d); });
}
export function shiftDay(value: string, amount: number): string {
  const date = parseInternshipDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + amount); return internshipDateString(date);
}
export function dayLogForm(day: InternshipDay): DayLogForm {
  return { experience: day.experience, learning: day.learning, nextStep: day.next_step, support: day.support_level, reason: '', taskId: day.task_id, attachment: day.attachment };
}
export function logFormError(form: DayLogForm, submit: boolean, previouslySubmitted: boolean): string | null {
  if (form.experience.length > 4000 || form.learning.length > 4000 || form.nextStep.length > 2000 || form.reason.length > 2000
    || (form.support !== null && (!Number.isInteger(form.support) || form.support < 0 || form.support > 3))) return 'days.invalid';
  if (submit && (!form.experience.trim() || !form.learning.trim() || form.support === null)) return 'days.required';
  if (previouslySubmitted && (!submit || !form.reason.trim())) return 'days.reasonRequired';
  return null;
}
export function daySummary(days: InternshipDay[]) {
  return { present: days.filter(d => d.attendance === 'present').length, partial: days.filter(d => d.attendance === 'partial').length,
    pending: days.filter(d => d.attendance === 'pending').length, corrections: days.filter(d => d.correction_requested).length,
    missingLogs: days.filter(d => ['present','partial'].includes(d.attendance) && d.log_status !== 'submitted').length };
}
export function needsAttendanceReview(day: InternshipDay): boolean {
  return day.attendance === 'pending' || day.correction_requested;
}
export function visibleDayDates(role: 'student' | 'mentor' | 'advisor', history: boolean, today: string, from: string, days: InternshipDay[]): string[] {
  if (role === 'student' && !history) return [today];
  const dates = dayWeek(from);
  return role === 'mentor' && !history
    ? dates.filter(date => days.some(day => day.day_date === date && needsAttendanceReview(day)))
    : dates;
}
export function dayError(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === 'PGRST202' || e?.code === '42P01') return 'days.notInstalled';
  const messages: Record<string,string> = { ID_FORBIDDEN: 'days.forbidden', ID_SETUP: 'days.setup', ID_INVALID: 'days.invalid',
    ID_REASON: 'days.reasonRequired', ID_CONFLICT: 'days.conflict', ID_REQUIRED: 'days.required' };
  return messages[e?.message || ''] || 'days.failed';
}
