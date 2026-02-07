export const colors = {
  primary: '#1a73e8',
  primaryLight: '#4a90d9',
  primaryDark: '#1557b0',

  secondary: '#34a853',
  secondaryLight: '#5bb974',
  secondaryDark: '#1e8e3e',

  background: '#f8f9fa',
  surface: '#ffffff',
  card: '#ffffff',

  text: '#202124',
  textSecondary: '#5f6368',
  textDisabled: '#9aa0a6',
  textOnPrimary: '#ffffff',

  border: '#dadce0',
  divider: '#e8eaed',

  error: '#d93025',
  warning: '#f9ab00',
  success: '#34a853',
  info: '#4285f4',

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
    draft: '#9aa0a6',
    submitted: '#4285f4',
    underReview: '#f9ab00',
    approved: '#34a853',
    needsRevision: '#ea4335',
    revised: '#fb8c00',
    validated: '#1b5e20',
  },
} as const;
