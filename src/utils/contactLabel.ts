/** The second line of a contact row. The role alone is not enough: an advisor
 *  knows their students by name but not which workplace mentor belongs to whom,
 *  so a mentor is shown with the students they mentor and a student with their
 *  mentor. Returns the pieces; the screen translates and joins them. */
export interface ContactLabel { roleKey: string; pairKey?: string; names: string }

export function contactLabel(role: string, pairs: string[] | undefined): ContactLabel {
  const names = (pairs ?? []).filter((n) => n && n.trim()).join(', ');
  const roleKey = role === 'advisor' ? 'messages.roleAdvisor'
    : role === 'mentor' ? 'messages.roleMentor' : 'messages.roleStudent';
  if (!names) return { roleKey, names: '' };
  return { roleKey, pairKey: role === 'mentor' ? 'messages.mentorOf' : 'messages.mentoredBy', names };
}
