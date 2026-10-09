// "Fjord Glass": the app's look (ADR-0021). Light and dark palettes; the scheme follows the device
// unless the user picks Light or Dark in the Account tab.
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as SystemUI from 'expo-system-ui';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { getPreference, setPreference } from './lib/storage';

const light = {
  scheme: 'light' as 'light' | 'dark',
  background: '#f3f4f7',
  surface: '#ffffff',
  surfaceAlt: 'rgba(14,17,22,0.06)',
  placeholder: '#dfe3ec',
  text: '#0e1116',
  subtle: '#474d5a',
  muted: '#5b6170',
  border: 'rgba(14,17,22,0.08)',
  accent: '#3b5bff',
  accentText: '#ffffff',
  /** Strong neutral for selected chips and the active tab. */
  ink: '#0e1116',
  inkText: '#ffffff',
  badge: '#d4f55a',
  badgeText: '#1a2200',
  danger: '#c2261f',
  success: '#1f7a3f',
  successText: '#ffffff',
  glass: 'rgba(255,255,255,0.72)',
  glassBorder: 'rgba(255,255,255,0.85)',
  shadow: 'rgba(30,45,110,0.28)',
};

const dark: typeof light = {
  scheme: 'dark',
  background: '#0b0d12',
  surface: '#151821',
  surfaceAlt: 'rgba(255,255,255,0.08)',
  placeholder: '#1f2430',
  text: '#eef0f3',
  subtle: '#c3c8d2',
  muted: '#9aa3ae',
  border: 'rgba(255,255,255,0.10)',
  accent: '#7b93ff',
  accentText: '#0b1230',
  ink: '#eef0f3',
  inkText: '#0b0d12',
  badge: '#d4f55a',
  badgeText: '#1a2200',
  danger: '#ff7b72',
  success: '#56d364',
  successText: '#0b0d12',
  glass: 'rgba(21,24,33,0.72)',
  glassBorder: 'rgba(255,255,255,0.08)',
  shadow: 'rgba(0,0,0,0.6)',
};

export type Theme = typeof light;
export type ThemePreference = 'system' | 'light' | 'dark';

/** Font families as registered with expo-font in the root layout (one family per weight). */
export const fonts = {
  body: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  display: 'BricolageGrotesque_700Bold',
  displayHeavy: 'BricolageGrotesque_800ExtraBold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 12, md: 18, lg: 24, xl: 32, pill: 999 } as const;

/**
 * Bottom padding that keeps scrolling content clear of the tab bar: iOS's native (Liquid Glass) bar,
 * or the floating bar elsewhere.
 */
export const tabBarSpace = Platform.OS === 'ios' ? 96 : 120;

const PREFERENCE_KEY = 'raadi.theme';

interface ThemeState {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setState] = useState<ThemePreference>('system');

  useEffect(() => {
    void getPreference(PREFERENCE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') setState(stored);
    });
  }, []);

  // Native controls (keyboard, alerts, the auth sheet) follow an explicit choice too.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    setState(next);
    void setPreference(PREFERENCE_KEY, next);
  }, []);

  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  // The root view behind every screen: no white flash during transitions in dark mode.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync((scheme === 'dark' ? dark : light).background).catch(
      () => undefined,
    );
  }, [scheme]);
  const value = useMemo(
    () => ({ theme: scheme === 'dark' ? dark : light, preference, setPreference: choose }),
    [scheme, preference, choose],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useThemeState(): ThemeState {
  const ctx = use(ThemeContext);
  if (!ctx) throw new Error('useThemeState outside ThemeProvider');
  return ctx;
}

export function useTheme(): Theme {
  return useThemeState().theme;
}
