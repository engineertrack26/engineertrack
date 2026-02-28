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

export const INTERVENTION_THRESHOLD_DAYS = 3;

export const COMPETENCY_RUBRIC: Record<string, { description: string; levels: string[] }> = {
  technical_skills: {
    description: 'Ability to apply engineering knowledge and tools effectively.',
    levels: [
      '1 - Beginner: Needs significant guidance to use basic tools.',
      '2 - Developing: Can use basic tools with some guidance.',
      '3 - Competent: Applies tools and methods independently.',
      '4 - Proficient: Selects and applies appropriate methods with confidence.',
      '5 - Expert: Innovates and mentors others in technical practices.',
    ],
  },
  problem_solving: {
    description: 'Ability to analyze problems and develop effective solutions.',
    levels: [
      '1 - Beginner: Struggles to identify problems without help.',
      '2 - Developing: Identifies problems but needs help with solutions.',
      '3 - Competent: Solves routine problems independently.',
      '4 - Proficient: Tackles complex problems with structured approaches.',
      '5 - Expert: Anticipates problems and creates innovative solutions.',
    ],
  },
  communication: {
    description: 'Ability to express ideas clearly in written and verbal forms.',
    levels: [
      '1 - Beginner: Difficulty expressing technical ideas clearly.',
      '2 - Developing: Communicates basic ideas with some clarity.',
      '3 - Competent: Communicates effectively in routine situations.',
      '4 - Proficient: Adapts communication style to different audiences.',
      '5 - Expert: Excellent communicator across all contexts.',
    ],
  },
  teamwork: {
    description: 'Ability to collaborate effectively within a team.',
    levels: [
      '1 - Beginner: Works mostly alone, minimal collaboration.',
      '2 - Developing: Participates when directed but rarely initiates.',
      '3 - Competent: Collaborates willingly and contributes regularly.',
      '4 - Proficient: Actively facilitates team success and resolves conflicts.',
      '5 - Expert: Leads teams and inspires collaborative culture.',
    ],
  },
  time_management: {
    description: 'Ability to plan and prioritize tasks effectively.',
    levels: [
      '1 - Beginner: Frequently misses deadlines.',
      '2 - Developing: Meets deadlines with reminders.',
      '3 - Competent: Plans work and meets deadlines consistently.',
      '4 - Proficient: Manages competing priorities effectively.',
      '5 - Expert: Optimizes workflows and helps others manage time.',
    ],
  },
  adaptability: {
    description: 'Ability to adjust to changing conditions and requirements.',
    levels: [
      '1 - Beginner: Resists change and struggles with new situations.',
      '2 - Developing: Accepts change but needs support to adapt.',
      '3 - Competent: Adjusts to changes with reasonable speed.',
      '4 - Proficient: Embraces change and adapts proactively.',
      '5 - Expert: Thrives in ambiguity and leads change initiatives.',
    ],
  },
  initiative: {
    description: 'Willingness to take action and go beyond assigned tasks.',
    levels: [
      '1 - Beginner: Only does what is explicitly asked.',
      '2 - Developing: Occasionally suggests ideas when prompted.',
      '3 - Competent: Identifies and acts on opportunities independently.',
      '4 - Proficient: Regularly proposes improvements and takes ownership.',
      '5 - Expert: Drives innovation and inspires others to take initiative.',
    ],
  },
  professional_ethics: {
    description: 'Adherence to professional standards and ethical behavior.',
    levels: [
      '1 - Beginner: Unaware of professional standards.',
      '2 - Developing: Follows rules when reminded.',
      '3 - Competent: Consistently follows ethical standards.',
      '4 - Proficient: Promotes ethical behavior in the workplace.',
      '5 - Expert: Models exemplary ethical conduct and mentors others.',
    ],
  },
};
