import { fromLocalIsoDate, toLocalIsoDate } from '@/utils/localDate';
export const internshipFields = ['university', 'faculty', 'department', 'department_branch', 'student_id',
  'company_name', 'company_address', 'company_sector', 'internship_start_date', 'internship_end_date'] as const;
export type InternshipField = typeof internshipFields[number];
export type InternshipForm = Record<InternshipField, string>;
export const requiredInternshipFields = ['university', 'department', 'student_id',
  'company_name', 'internship_start_date', 'internship_end_date'] as const satisfies readonly InternshipField[];
export type RequiredInternshipField = typeof requiredInternshipFields[number];
/** What the form writes: the NOT NULL columns of student_profiles always a
 *  string (validated non-empty), the rest a string or null. */
export type InternshipPayload = Record<RequiredInternshipField, string> & Record<Exclude<InternshipField, RequiredInternshipField>, string | null>;

export function readInternshipForm(row: Record<string, unknown> | null): InternshipForm {
  return Object.fromEntries(internshipFields.map((field) => [field, typeof row?.[field] === 'string' ? row[field] : ''])) as InternshipForm;
}
export function parseInternshipDate(value: string): Date | null {
  return fromLocalIsoDate(value);
}
export function internshipDateString(date: Date): string {
  return toLocalIsoDate(date);
}
export function validateInternshipForm(form: InternshipForm): Partial<Record<InternshipField, 'required' | 'date' | 'order'>> {
  const errors: ReturnType<typeof validateInternshipForm> = {};
  for (const field of requiredInternshipFields) if (!form[field].trim()) errors[field] = 'required';
  const start = parseInternshipDate(form.internship_start_date), end = parseInternshipDate(form.internship_end_date);
  if (form.internship_start_date && !start) errors.internship_start_date = 'date';
  if (form.internship_end_date && !end) errors.internship_end_date = 'date';
  if (start && end && end < start) errors.internship_end_date = 'order';
  return errors;
}
export function internshipPayload(form: InternshipForm): InternshipPayload {
  const required: readonly InternshipField[] = requiredInternshipFields;
  return Object.fromEntries(internshipFields.map((field) => [field,
    form[field].trim() || (required.includes(field) ? '' : null)])) as InternshipPayload;
}
export function sameInternshipForm(a: InternshipForm, b: InternshipForm): boolean {
  return internshipFields.every((field) => a[field] === b[field]);
}
export function internshipReturnPath(value?: string): '/(student)/dashboard' | '/(student)/profile' {
  return value === 'dashboard' ? '/(student)/dashboard' : '/(student)/profile';
}
