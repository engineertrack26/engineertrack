import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { passwordFormError, PROFILE_LANGUAGES, profileError } from '../mentorProfile';

describe('mentor profile validation', () => {
  it('requires the current password and matching new passwords without trimming secrets', () => {
    expect(passwordFormError('', 'abcdef', 'abcdef')).toBe('mentorProfile.currentRequired');
    expect(passwordFormError('old', 'short', 'short')).toBe('mentorProfile.passwordLength');
    expect(passwordFormError('old', 'abcdef', 'abcdef ')).toBe('mentorProfile.passwordMismatch');
    expect(passwordFormError('old', ' abcdef ', ' abcdef ')).toBeNull();
  });
  it('uses readable error keys rather than leaking raw auth or storage errors', () => {
    expect(profileError({ code: 'invalid_credentials' })).toBe('mentorProfile.wrongPassword');
    expect(profileError({ code: 'weak_password' })).toBe('mentorProfile.weakPassword');
    expect(profileError({ code: 'photo_permission' })).toBe('mentorProfile.photoPermission');
    expect(profileError(new Error('private server details'))).toBe('mentorProfile.failed');
  });
  it('offers exactly seven supported, unique language choices', () => {
    expect(PROFILE_LANGUAGES.map(item => item.code).sort()).toEqual(['de', 'el', 'en', 'it', 'ro', 'sr', 'tr']);
    expect(new Set(PROFILE_LANGUAGES.map(item => item.label)).size).toBe(7);
  });
});

const resources = Object.fromEntries(PROFILE_LANGUAGES.map(({ code }) => [code,
  JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/locales', code + '.json'), 'utf8'))]));
const sources = ['src/components/mentor/MentorProfile.tsx', 'src/components/mentor/ProfileSheet.tsx', 'src/utils/mentorProfile.ts'];
const keys = [...new Set(sources.flatMap(path => [...readFileSync(join(process.cwd(), path), 'utf8')
  .matchAll(/['"]((?:mentorProfile|common|auth|tabs)\.[A-Za-z]+)['"]/g)].map(match => match[1])))];
it.each(PROFILE_LANGUAGES.map(item => item.code))('has profile translations in %s', language => {
  expect(Object.keys(resources[language].mentorProfile).sort()).toEqual(Object.keys(resources.en.mentorProfile).sort());
  for (const key of keys) {
    const [section, name] = key.split('.');
    expect({ key, type: typeof resources[language][section]?.[name] }).toEqual({ key, type: 'string' });
  }
});
