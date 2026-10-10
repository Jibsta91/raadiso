import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ErrorReporting } from '@/components/error-reporting';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { bricolage, geist } from '@/app/fonts';
import { routing } from '@/i18n/routing';
import { env } from '@/lib/env';
import { GLOBAL, pickMessages } from '@/lib/client-messages';
import { isAdminHost } from '@/lib/host';
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Browser chrome follows the page (light and dark backgrounds); content reaches under the notch, and
// the header and bottom bars pad themselves with the safe-area insets.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f4f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
  viewportFit: 'cover',
};

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
  // Client components get only the text they use: the frame's here, a page's own through
  // <ClientMessages> (lib/client-messages.ts). Server components need none in the page.
  const clientMessages = pickMessages(messages as never, GLOBAL);

  return (
    <html
      lang={locale}
      data-theme={themeAttribute(theme)}
      className={`${geist.variable} ${bricolage.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-inverse focus:px-4 focus:py-2 focus:text-inverse-foreground"
        >
          {t('skip')}
        </a>
        <ErrorReporting
          publicKey={env.errorsPublicKey}
          projectId={env.errorsProjectId}
          release={env.release}
          environment={env.environment}
        />
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
