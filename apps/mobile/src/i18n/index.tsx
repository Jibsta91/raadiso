import { getLocales } from 'expo-localization';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { APP_LOCALES } from '../lib/country';
import { pickLocale, type Locale } from '../lib/format';
import { getPreference, setPreference } from '../lib/storage';
import { catalogues, type Messages } from './messages';

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  m: Messages;
}

const I18nContext = createContext<I18n | null>(null);
const LOCALE_KEY = 'raadi.locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    pickLocale(
      getLocales().map((l) => l.languageTag),
      APP_LOCALES,
    ),
  );
  // A language picked on the account screen is remembered across starts.
  useEffect(() => {
    void getPreference(LOCALE_KEY).then((saved) => {
      const offered = APP_LOCALES.find((l) => l === saved);
      if (offered) setLocaleState(offered);
    });
  }, []);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void setPreference(LOCALE_KEY, next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale, m: catalogues[locale] }), [locale, setLocale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const ctx = use(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** Fills `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
