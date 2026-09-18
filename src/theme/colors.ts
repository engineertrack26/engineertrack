export const colors = {
  primary: '#12315E',
  primaryLight: '#3E5375',
  primaryDark: '#12315E',

  secondary: '#2F7D5B',
  secondaryLight: '#E7F2EC',
  secondaryDark: '#2F7D5B',

  background: '#EEF0EC',
  surface: '#FFFFFF',
  card: '#FFFFFF',

  text: '#1B2430',
  textSecondary: '#5B6672',
  textDisabled: '#9AA59B',
  textOnPrimary: '#ffffff',

  border: '#9AA59B',
  divider: '#D3D8D1',

  error: '#B3261E',
  warning: '#D9A400',
  success: '#2F7D5B',
  info: '#3E5375',

  // "Staj Defteri" design tokens
  ink: '#12315E',
  inkSoft: '#3E5375',
  paper: '#FFFFFF',
  page: '#EEF0EC',
  rule: '#D3D8D1',
  ruleStrong: '#9AA59B',
  stamp: '#2F7D5B',
  stampBg: '#E7F2EC',
  warnBg: '#FBF3D6',
  warnText: '#8A6800',

  // Gamification colors
  gamification: {
    gold: '#ffc107',
    silver: '#9e9e9e',
    bronze: '#cd7f32',
    streak: '#ff6d00',
    xp: '#7c4dff',
    levelUp: '#00c853',
    badge: '#ffd600',
  },

  // Log status colors
  status: {
    draft: '#9AA59B',
    submitted: '#3E5375',
    underReview: '#D9A400',
    approved: '#2F7D5B',
    needsRevision: '#8A6800',
    revised: '#D9A400',
    validated: '#2F7D5B',
  },
} as const;
