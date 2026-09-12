export const INTERNSHIP_FIELDS = [
  ['university', 'student.universityName'], ['faculty', 'student.facultyName'],
  ['department', 'student.departmentName'], ['department_branch', 'student.departmentBranch'],
  ['student_id', 'student.studentId'], ['company_name', 'student.companyName'],
  ['company_address', 'student.companyAddress'], ['company_sector', 'student.companySector'],
  ['internship_start_date', 'student.internshipStartDate'], ['internship_end_date', 'student.internshipEndDate'],
] as const;

export function internshipInfoComplete(profile: Record<string, unknown> | null): boolean {
  return !!profile && ['university', 'department', 'company_name', 'student_id', 'internship_start_date', 'internship_end_date']
    .every(key => typeof profile[key] === 'string' && (profile[key] as string).trim().length > 0);
}

export function profileField(value: unknown, isDate: boolean, locale: string): string {
  if (typeof value !== 'string' || !value.trim()) return '—';
  if (!isDate) return value;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '—';
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '—';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
