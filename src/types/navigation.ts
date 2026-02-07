export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  LanguageSelect: undefined;
};

export type StudentTabParamList = {
  Dashboard: undefined;
  CreateLog: undefined;
  LogHistory: undefined;
  Achievements: undefined;
  Leaderboard: undefined;
};

export type MentorTabParamList = {
  Dashboard: undefined;
  StudentList: undefined;
  ReviewLog: { logId: string };
  FeedbackForm: { logId: string; studentId: string };
};

export type AdvisorTabParamList = {
  Dashboard: undefined;
  StudentMonitor: undefined;
  Validation: { logId: string };
  Reports: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  StudentTabs: undefined;
  MentorTabs: undefined;
  AdvisorTabs: undefined;
  Settings: undefined;
  Notifications: undefined;
  ProfileEdit: undefined;
};
