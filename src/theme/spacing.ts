export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

// Staj Defteri: paper corners are barely rounded; only circles use `full`.
export const borderRadius = {
  xs: 4,
  sm: 6,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;
