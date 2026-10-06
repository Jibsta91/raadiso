import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { isAdminHost } from '@/lib/host';
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme';

const SERVER_ONLY = new Set(['admin', 'terms', 'privacy']);

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    // Relative URLs in metadata (canonical, hreflang, Open Graph images) resolve against the site.
    metadataBase: new URL(env.publicBaseUrl),
    title: { default: t('title'), template: `%s · Raadiso` },
    description: t('description'),
    openGraph: { siteName: 'Raadiso', locale, type: 'website' },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, jar, admin, messages] = await Promise.all([
    getTranslations('nav'),
    cookies(),
    isAdminHost(),
    getMessages(),
  ]);
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  // Client components get the text they may need. On the website that leaves out the admin console's
  // strings (about half of all text) and the legal pages, which render on the server only.
  const clientMessages = admin
    ? messages
    : Object.fromEntries(Object.entries(messages).filter(([ns]) => !SERVER_ONLY.has(ns)));

  return (
    <html lang={locale} data-theme={themeAttribute(theme)}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-foreground"
        >
          {t('skip')}
        </a>
        <NextIntlClientProvider messages={clientMessages}>
          {admin ? (
            // The admin console brings its own frame (app/[locale]/admin/layout.tsx).
            children
          ) : (
            <>
              <Header locale={locale} />
              <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-8">
                {children}
              </main>
              <Footer theme={theme} />
            </>
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
