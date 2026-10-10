import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@raadi/ui';
import { KeyRound, Languages, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VerifyButton } from '@/components/trust/verification';
import { Link } from '@/i18n/navigation';
import { safePath } from '@/lib/safe-path';
import { currentCountryConfig, currentLocales } from '@/lib/host';
import { getSession } from '@/lib/session';
import { ClientMessages } from '@/components/client-messages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('welcome');
  return { title: t('title'), robots: { index: false } };
}

/** Shown once, after a new user's first login (identity-bff redirects here). */
export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(`/${locale}/welcome`)}&locale=${locale}`);
  }
  const [t, tAccount, { locales }] = await Promise.all([
    getTranslations('welcome'),
    getTranslations('account'),
    currentLocales(),
  ]);
  // The languages this country's site offers (ADR-0053), in their own names.
  const languages = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    locales.map((l) => tAccount(`locales.${l}` as never)),
  );
  // Verification only where the country has a provider (BankID in Norway; none in Somaliland yet).
  const verification = (await currentCountryConfig()).identityVerification !== null;
  const next = safePath((await searchParams).next, `/${locale}`);
  const firstName = session.user.name?.split(' ')[0];

  return (
    <ClientMessages set="trust">
      <div className="mx-auto max-w-2xl space-y-6" data-testid="welcome">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">
            {firstName ? t('greeting', { name: firstName }) : t('title')}
          </h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages aria-hidden className="size-5" />
              {t('languageTitle')}
            </CardTitle>
            <CardDescription>{t('languageHint', { languages })}</CardDescription>
          </CardHeader>
        </Card>

        {verification ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck aria-hidden className="size-5" />
                {t('verifyTitle')}
              </CardTitle>
              <CardDescription>{t('verifyHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <VerifyButton locale={locale} />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound aria-hidden className="size-5" />
              {t('passkeyTitle')}
            </CardTitle>
            <CardDescription>{t('passkeyHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a
                href={`/auth/login?action=webauthn-register-passwordless&returnTo=${encodeURIComponent(`/${locale}/account/security`)}&locale=${locale}`}
              >
                {t('passkeyAction')}
              </a>
            </Button>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button asChild data-testid="welcome-continue">
            <a href={next}>{t('continue')}</a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/listings/new">{t('sell')}</Link>
          </Button>
        </div>
      </div>
    </ClientMessages>
  );
}
