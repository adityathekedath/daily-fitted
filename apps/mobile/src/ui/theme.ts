import { useColorScheme } from 'react-native';

const light = {
  background: '#FAFAF7',
  surface: '#FFFFFF',
  text: '#15130F',
  muted: '#6B675F',
  border: '#E3E0D8',
  accent: '#15130F',
  onAccent: '#FAFAF7',
  danger: '#B3261E',
};

const dark: typeof light = {
  background: '#0F0E0C',
  surface: '#1A1916',
  text: '#F2EFE8',
  muted: '#A19C92',
  border: '#2E2C27',
  accent: '#F2EFE8',
  onAccent: '#0F0E0C',
  danger: '#F2B8B5',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
