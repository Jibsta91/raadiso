import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { currentLocales } from '@/lib/host';
import { getSession } from '@/lib/session';
import type { ThemePreference } from '@/lib/theme';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeSwitcher } from './theme-switcher';

const link = 'rounded text-subtle-foreground hover:text-foreground hover:underline';

export async function Footer({ theme }: { theme: ThemePreference }) {
  const [t, tNav, session, { locales }] = await Promise.all([
    getTranslations('footer'),
    getTranslations('nav'),
    getSession(),
    currentLocales(),
  ]);
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 text-sm text-muted-foreground sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-display text-xl font-extrabold tracking-[-0.04em] text-foreground">
            raadiso<span className="text-primary">.</span>
          </span>
          <span>{t('tagline')}</span>
        </div>
        <nav aria-label={t('links')} className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" prefetch={false} className={link}>
            {t('privacy')}
          </Link>
          <Link href="/terms" prefetch={false} className={link}>
            {t('terms')}
          </Link>
          <Link href="/status" prefetch={false} className={link}>
            {t('status')}
          </Link>
          <span>{t('openSource')}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <LocaleSwitcher
            label={tNav('language')}
            signedIn={session.authenticated}
            locales={locales}
          />
          <ThemeSwitcher initial={theme} />
        </div>
      </div>
    </footer>
  );
}
