import { SupportedLanguage } from '@/types/user';

export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'sr', label: 'Srpski' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'it', label: 'Italiano' },
  { code: 'ro', label: 'Română' },
  { code: 'de', label: 'Deutsch' },
];

export const LOG_STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  needs_revision: 'Needs Revision',
  revised: 'Revised',
  validated: 'Validated',
} as const;

export const LIMITS = {
  maxPhotosPerLog: 5,
  maxDocumentsPerLog: 3,
  maxFileSizeMB: 10,
  minLogContentLength: 50,
  maxLogContentLength: 5000,
  minTitleLength: 5,
  maxTitleLength: 100,
} as const;

export const INTERVENTION_THRESHOLD_DAYS = 3;

/**
 * Bumping this invalidates every stored consent and re-prompts all users.
 * Change it whenever the text under `legal.privacy` in the locale files changes
 * in substance.
 */
export const PRIVACY_POLICY_VERSION = '1.0';
