import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILE_LANGUAGES } from '../mentorProfile';

// Wiring contract: advisor must use the tested account controls without mentor navigation.
const source = readFileSync(join(process.cwd(), 'app/(advisor)/profile.tsx'), 'utf8');
test('advisor renders the shared account UI, keyed to the signed-in account', () => {
  expect(source).toContain('<AccountProfile key={user.id} user={user}');
  expect(source).toContain("user.role !== 'advisor'");
  expect(source).not.toContain('StaffProfileScreen');
});
test('advisor uses its own notification header and a translated role label', () => {
  expect(source).toContain('<AdvisorBell />');
  expect(source).toContain("roleLabel={t('auth.advisor')}");
  expect(source).not.toContain('ReviewHeader');
  expect(source).not.toContain('/(mentor)/');
});
test.each(PROFILE_LANGUAGES.map(item => item.code))('advisor role has a label in %s', code => {
  const locale = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/locales', code + '.json'), 'utf8'));
  expect(typeof locale.auth.advisor).toBe('string');
  expect(locale.auth.advisor.trim()).not.toBe('');
});
