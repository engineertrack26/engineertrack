import { readFileSync } from 'fs';
import { resolve } from 'path';
const root = resolve(__dirname, '../../..');

test('advisor avatar SQL restricts access to owned groups and active student memberships', () => {
  const sql = readFileSync(resolve(root, 'docs/advisor-student-avatars-migration.sql'), 'utf8');
  for (const guard of ["role = 'advisor'", "p.role = 'student'", 'm.left_at IS NULL',
    'g.advisor_id = auth.uid()', 'p_group_id IS NULL OR g.id = p_group_id',
    'public.calculate_level(coalesce(s.total_xp, 0))',
    'REVOKE ALL ON FUNCTION public.advisor_student_avatars(uuid) FROM PUBLIC, anon, authenticated;',
    'GRANT EXECUTE ON FUNCTION public.advisor_student_avatars(uuid) TO authenticated;']) expect(sql).toContain(guard);
  expect(sql).not.toMatch(/GRANT\s+SELECT|UPDATE\s+public\.|INSERT\s+INTO/i);
});

test('monitor shows bounded shared avatar with server level and initials fallback', () => {
  const screen = readFileSync(resolve(root, 'app/(advisor)/student-monitor.tsx'), 'utf8');
  expect(screen).toContain('getAdvisorStudentAvatars(groupId)');
  expect(screen).toContain('if (current()) setAvatars(result)');
  expect(screen).toContain('level={avatars[item.id].level} size={48} markers={false}');
  expect(screen).toContain('(item.firstName[0]');
});
