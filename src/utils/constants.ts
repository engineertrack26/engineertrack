import { SupportedLanguage } from '@/types/user';

export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
];

export const COMPETENCIES = [
  'technical_skills',
  'problem_solving',
  'communication',
  'teamwork',
  'time_management',
  'adaptability',
  'initiative',
  'professional_ethics',
] as const;

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
  maxCompetencyRating: 5,
  minCompetencyRating: 1,
} as const;
