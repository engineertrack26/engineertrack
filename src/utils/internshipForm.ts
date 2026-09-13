export const internshipFields = ['university', 'faculty', 'department', 'department_branch', 'student_id',
  'company_name', 'company_address', 'company_sector', 'internship_start_date', 'internship_end_date'] as const;
export type InternshipField = typeof internshipFields[number];
export type InternshipForm = Record<InternshipField, string>;
export const requiredInternshipFields: InternshipField[] = ['university', 'department', 'student_id',
  'company_name', 'internship_start_date', 'internship_end_date'];

export function readInternshipForm(row: Record<string, unknown> | null): InternshipForm {
  return Object.fromEntries(internshipFields.map((field) => [field, typeof row?.[field] === 'string' ? row[field] : ''])) as InternshipForm;
}
export function parseInternshipDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}
export function internshipDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
export function internshipPayload(form: InternshipForm): Record<InternshipField, string | null> {
  return Object.fromEntries(internshipFields.map((field) => [field,
    form[field].trim() || (requiredInternshipFields.includes(field) ? '' : null)])) as Record<InternshipField, string | null>;
}
export function sameInternshipForm(a: InternshipForm, b: InternshipForm): boolean {
  return internshipFields.every((field) => a[field] === b[field]);
}
export function internshipReturnPath(value?: string): '/(student)/dashboard' | '/(student)/profile' {
  return value === 'dashboard' ? '/(student)/dashboard' : '/(student)/profile';
}
