import { TextStyle } from 'react-native';
import { fonts } from './fonts';

export const typography: Record<string, TextStyle> = {
  h1: {
    fontSize: 32,
    fontWeight: '600',
    lineHeight: 40,
    fontFamily: fonts.semibold,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
    fontFamily: fonts.semibold,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
    fontFamily: fonts.semibold,
  },
  h4: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    fontFamily: fonts.semibold,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    fontFamily: fonts.regular,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    fontFamily: fonts.regular,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
    fontFamily: fonts.regular,
  },
  button: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    fontFamily: fonts.semibold,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    fontFamily: fonts.medium,
  },
} as const;
