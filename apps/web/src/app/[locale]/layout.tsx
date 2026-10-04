import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { routing } from '@/i18n/routing';
import { isAdminHost } from '@/lib/host';
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme';

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
    title: { default: t('title'), template: `%s · Raadiso` },
    description: t('description'),
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
  const [t, jar, admin] = await Promise.all([getTranslations('nav'), cookies(), isAdminHost()]);
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} data-theme={themeAttribute(theme)}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-foreground"
        >
          {t('skip')}
        </a>
        <NextIntlClientProvider>
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
