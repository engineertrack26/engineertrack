export interface MentorStudent {
  id: string;
  name: string;
  company: string;
  start?: string;
  end?: string;
  xp: number | null;
  level: number | null;
  streak: number | null;
}

export function mapMentorStudent(row: Record<string, unknown>): MentorStudent {
  const profile = row.profiles as Record<string, unknown> | null;
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return { id: String(row.id), name: `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim(),
    company: String(row.company_name || ''), start: row.internship_start_date as string | undefined,
    end: row.internship_end_date as string | undefined, xp: number(row.total_xp),
    level: number(row.current_level), streak: number(row.current_streak) };
}

export function filterMentorStudents(students: MentorStudent[], query: string, pendingOnly: boolean,
  counts: Record<string, number> | null, locale: string): MentorStudent[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  return students.filter(student => student.name.toLocaleLowerCase(locale).includes(needle) &&
    (!pendingOnly || (counts !== null && (counts[student.id] || 0) > 0)))
    .sort((a, b) => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id));
}

// Interpret date-only values locally, not at UTC midnight (which can shift a day).
export function internshipDates(start: string | undefined, end: string | undefined, locale: string): string | null {
  const parse = (value?: string) => {
    const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  };
  const from = parse(start), to = parse(end);
  if (!from || !to || from > to) return null;
  const format = (date: Date) => date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${format(from)} – ${format(to)}`;
}
