import { supabase } from './supabase';
import type { Attendance, DayEvent, DayLogForm, DayTask, InternshipDay, InternshipPerson } from '@/types/internshipDay';
import { uploadToBucket } from './evidenceUrls';
import type { daySummary } from '@/utils/internshipDays';
import type { RpcArgs, RpcName } from './rpc';
import type { Json } from '@/types/database';
/** Like services/rpc.ts, plus a 15 s abort: these calls sit behind the
 *  attendance strip and must not hang the dashboard. */
async function rpc<T, N extends RpcName = RpcName>(name: N, args: RpcArgs<N> = {} as RpcArgs<N>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = supabase.rpc(name, args).abortSignal(controller.signal);
    const { data, error } = await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Request timeout')); },15000); }),
    ]);
    if (error) throw error;
    return data as T;
  } finally { if (timer) clearTimeout(timer); }
}
export const internshipDayService = {
  people: () => rpc<InternshipPerson[]>('internship_people'),
  week: (studentId: string, from: string) => rpc<InternshipDay[]>('internship_week', { p_student_id: studentId, p_from: from }),
  totals: (studentId: string) => rpc<ReturnType<typeof daySummary>>('internship_totals', { p_student_id: studentId }),
  open: (studentId: string, date: string, timezone: string, reason: string) => rpc<string>('internship_open_day',
    { p_student_id: studentId, p_date: date, p_timezone: timezone, p_reason: reason.trim() }),
  saveLog: (day: InternshipDay, form: DayLogForm, submit: boolean) => rpc<void>('internship_save_log', {
    p_day: day.id, p_version: day.version, p_experience: form.experience.trim(), p_learning: form.learning.trim(),
    p_next_step: form.nextStep.trim(), p_support: form.support as number, p_submit: submit, p_reason: form.reason.trim(),
    p_task: form.taskId ?? undefined, p_attachment: (form.attachment ?? undefined) as Json | undefined,
  }),
  review: (days: InternshipDay[], status: Exclude<Attendance,'pending'>, note: string) => rpc<void>('internship_review',
    { p_days: days.map(d => ({ id: d.id, version: d.version })), p_status: status, p_note: note.trim() }),
  note: (day: InternshipDay, note: string, correction: boolean) => rpc<void>('internship_note',
    { p_day: day.id, p_version: day.version, p_note: note.trim(), p_correction: correction }),
  events: (dayId: string) => rpc<DayEvent[]>('internship_events', { p_day: dayId }),
  tasks: (dayId: string) => rpc<DayTask[]>('internship_tasks', { p_day: dayId }),
  async upload(day: InternshipDay, asset: { uri: string; name: string; mimeType?: string; size?: number }) {
    const mime = asset.mimeType || '';
    if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(mime) || !asset.size || asset.size > 10485760) throw { message: 'ID_INVALID' };
    const { data, error } = await supabase.auth.getSession();
    if (error || data.session?.user.id !== day.student_id) throw { message: 'ID_FORBIDDEN' };
    const path = `${day.student_id}/${day.id}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await uploadToBucket('internship-day-files',path,asset.uri,asset.name,mime);
    return { path, name: asset.name.slice(0,255) };
  },
  async fileUrl(path: string) {
    const { data, error } = await supabase.storage.from('internship-day-files').createSignedUrl(path,300);
    if (error || !data?.signedUrl) throw error || new Error('File unavailable');
    return data.signedUrl;
  },
};
