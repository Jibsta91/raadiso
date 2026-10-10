import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { currentLocales } from '@/lib/host';
import { getSession } from '@/lib/session';
import type { ThemePreference } from '@/lib/theme';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeSwitcher } from './theme-switcher';

const link = 'focus-ring rounded text-subtle-foreground hover:text-foreground hover:underline';

/**
 * For shoppers: what Raadiso is and how to stay safe (the terms' own sections), help pages, and the
 * language and theme. Only pages that exist; the open-source licence is on the status page.
 */
export async function Footer({ theme }: { theme: ThemePreference }) {
  const [t, tNav, session, { locales }] = await Promise.all([
    getTranslations('footer'),
    getTranslations('nav'),
    getSession(),
    currentLocales(),
  ]);
  const columns = [
    {
      key: 'about',
      title: t('about'),
      links: [
        { href: '/terms#service', label: t('howItWorks') },
        { href: '/terms#conduct', label: t('safety') },
      ],
    },
    {
      key: 'help',
      title: t('help'),
      links: [
        { href: '/status', label: t('status') },
        { href: '/privacy', label: t('privacy') },
        { href: '/terms', label: t('terms') },
      ],
    },
  ];
  return (
    <footer className="border-t pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:px-8 md:grid-cols-[1.2fr_2fr_auto]">
        <div className="flex flex-col gap-1">
          <span className="font-display text-xl font-extrabold tracking-[-0.04em] text-foreground">
            raadiso<span className="text-primary">.</span>
          </span>
          <span className="text-muted-foreground">{t('tagline')}</span>
        </div>
        <nav aria-label={t('links')} className="grid grid-cols-2 gap-8">
          {columns.map((c) => (
            <div key={c.key} className="flex flex-col gap-2">
              <h2 className="font-sans text-sm font-semibold tracking-normal text-foreground">
                {c.title}
              </h2>
              <ul className="flex flex-col gap-2" role="list">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} prefetch={false} className={link}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div
          className="flex flex-wrap items-start gap-3 md:justify-end"
          role="group"
          aria-label={t('settings')}
        >
          <LocaleSwitcher
            label={tNav('language')}
            signedIn={session.authenticated}
            locales={locales}
          />
          <ThemeSwitcher initial={theme} />
        </div>
        <p className="text-xs text-muted-foreground md:col-span-3">
          {t('copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
