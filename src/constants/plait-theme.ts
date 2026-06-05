/**
 * plAIt design tokens. Dark, minimal, premium — this gets shown to people.
 */
import { Platform } from 'react-native';

export const Plait = {
  color: {
    background: '#111111',
    card: '#1C1C1C',
    cardElevated: '#262626',
    coral: '#E8704A',
    teal: '#4ECDC4',
    text: '#F5F0E8', // cream
    textDim: '#9A958C',
    border: '#2C2C2C',
    danger: '#E85A4A',
    warn: '#E8B44A',
  },
  font: {
    serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' }),
    sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  },
  space: {
    xs: 6,
    sm: 12,
    md: 18,
    lg: 28,
    xl: 40,
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 24,
    pill: 999,
  },
} as const;
