'use client';

import { cn } from '@raadi/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { THEME_COOKIE, THEMES, themeAttribute, type ThemePreference } from '@/lib/theme';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const CHANGED = 'raadi:theme';

/** System / Light / Dark. Applies at once and remembers the choice for a year. */
export function ThemeSwitcher({
  initial,
  className,
  testId = 'theme-switcher',
  compact = false,
}: {
  initial: ThemePreference;
  className?: string;
  testId?: string;
  /** Icons only (the label becomes the button's name), for narrow places like a sidebar. */
  compact?: boolean;
}) {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState(initial);

  // A page can show more than one switcher (footer and account page): keep them in step.
  useEffect(() => {
    const sync = (e: Event) => setTheme((e as CustomEvent<ThemePreference>).detail);
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);

  function choose(next: ThemePreference) {
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: next }));
    const attribute = themeAttribute(next);
    if (attribute) document.documentElement.dataset.theme = attribute;
    else delete document.documentElement.dataset.theme;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      data-testid={testId}
      className={cn('inline-flex rounded-full bg-secondary p-1', className)}
    >
      {THEMES.map((option) => {
        const Icon = ICONS[option];
        const selected = option === theme;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            data-testid={`theme-${option}`}
            onClick={() => choose(option)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium motion-safe:transition-colors focus-ring',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {compact ? <span className="sr-only">{t(option)}</span> : t(option)}
          </button>
        );
      })}
    </div>
  );
}
