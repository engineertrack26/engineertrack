import type { SupportedLanguage } from '@/types/user';
import { PASSWORD_MIN_LENGTH } from '@/utils/passwordPolicy';

export const PROFILE_LANGUAGES: { code: SupportedLanguage; label: string }[] = [
  { code: 'tr', label: 'Türkçe' }, { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' }, { code: 'it', label: 'Italiano' },
  { code: 'ro', label: 'Română' }, { code: 'sr', label: 'Srpski' }, { code: 'el', label: 'Ελληνικά' },
];
export function passwordFormError(current: string, next: string, confirm: string): string | null {
  if (!current) return 'mentorProfile.currentRequired';
  if (next.length < PASSWORD_MIN_LENGTH) return 'mentorProfile.passwordLength';
  if (next !== confirm) return 'mentorProfile.passwordMismatch';
  return null;
}

export function profileError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'photo_permission') return 'mentorProfile.photoPermission';
  if (code === 'photo_canceled') return 'mentorProfile.photoCanceled';
  if (code === 'invalid_credentials') return 'mentorProfile.wrongPassword';
  if (code === 'weak_password') return 'mentorProfile.weakPassword';
  if (code === 'same_password') return 'mentorProfile.samePassword';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'mentorProfile.rateLimit';
  return 'mentorProfile.failed';
}
