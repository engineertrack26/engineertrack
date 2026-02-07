// Route parameter types for Expo Router
// These are used with useLocalSearchParams<T>() in screen components

export type AuthRoutes = {
  login: undefined;
  register: undefined;
  'forgot-password': undefined;
  'language-select': undefined;
};

export type StudentRoutes = {
  dashboard: undefined;
  'create-log': undefined;
  'log-history': undefined;
  achievements: undefined;
  leaderboard: undefined;
};

export type MentorRoutes = {
  dashboard: undefined;
  'student-list': undefined;
  'review-log': { logId: string };
  feedback: { logId: string; studentId: string };
};

export type AdvisorRoutes = {
  dashboard: undefined;
  'student-monitor': undefined;
  validation: { logId: string };
  reports: undefined;
};
