import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@raadi/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { RemoveVerification, VerifyButton } from '@/components/trust/verification';
import { VerifiedBadge } from '@/components/trust/verified-badge';
import { Link } from '@/i18n/navigation';
import { myTrust } from '@/lib/api';
import { getMe, getSession } from '@/lib/session';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('title'), robots: { index: false } };
}

const OUTCOMES = ['ok', 'cancelled', 'taken', 'expired', 'failed'] as const;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ verification?: string }>;
}) {
  const { locale } = await params;
  const { verification: outcomeParam } = await searchParams;
  const outcome = OUTCOMES.find((o) => o === outcomeParam);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(`/${locale}/account`)}&locale=${locale}`);
  }
  const [t, tt, tTheme, format, me, trust, jar] = await Promise.all([
    getTranslations('account'),
    getTranslations('trust'),
    getTranslations('theme'),
    getFormatter(),
    getMe(),
    myTrust().catch(() => null),
    cookies(),
  ]);
  const user = session.user;
  const date = (iso: string | null | undefined) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{me?.displayName ?? user.name ?? user.email}</CardTitle>
          <CardDescription>{t('signedInAs', { email: user.email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">{t('email')}</dt>
            <dd data-testid="account-email">{user.email}</dd>
            <dt className="text-muted-foreground">{t('locale')}</dt>
            <dd>{t(`locales.${me?.locale ?? user.locale}`)}</dd>
            <dt className="text-muted-foreground">{t('roles')}</dt>
            <dd className="flex flex-wrap gap-1">
              {user.roles
                .filter(
                  (r) =>
                    !r.startsWith('default-roles-') &&
                    r !== 'offline_access' &&
                    r !== 'uma_authorization',
                )
                .map((role) => (
                  <Badge key={role} variant="secondary">
                    {role}
                  </Badge>
                ))}
            </dd>
            <dt className="text-muted-foreground">{t('memberSince')}</dt>
            <dd>{date(me?.createdAt)}</dd>
            <dt className="text-muted-foreground">{t('lastLogin')}</dt>
            <dd>{date(me?.lastLoginAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card data-testid="verification-card">
        <CardHeader>
          <CardTitle>{tt('verificationTitle')}</CardTitle>
          <CardDescription>{tt('verificationHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {outcome ? (
            <p
              role="status"
              data-testid="verification-outcome"
              data-outcome={outcome}
              className={outcome === 'ok' ? 'text-sm text-success' : 'text-sm text-destructive'}
            >
              {tt(`outcomes.${outcome}`)}
            </p>
          ) : null}
          {trust === null ? (
            <p className="text-sm text-muted-foreground">{tt('unavailable')}</p>
          ) : trust.verification ? (
            <div className="flex flex-wrap items-center gap-3">
              <VerifiedBadge
                label={tt('verifiedSince', {
                  date: format.dateTime(new Date(trust.verification.verifiedAt), {
                    dateStyle: 'medium',
                  }),
                })}
              />
              <RemoveVerification />
            </div>
          ) : (
            <VerifyButton locale={locale} />
          )}
          {trust ? (
            <Link
              href={`/users/${trust.userId}`}
              className="block text-sm text-primary hover:underline"
              data-testid="my-profile-link"
            >
              {tt('seeMyProfile')}
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tTheme('label')}</CardTitle>
          <CardDescription>{tTheme('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSwitcher
            initial={parseTheme(jar.get(THEME_COOKIE)?.value)}
            testId="account-theme-switcher"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('securityTitle')}</CardTitle>
          <CardDescription>{t('securityHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="outline" data-testid="open-security">
            <Link href="/account/security">{t('manageSecurity')}</Link>
          </Button>
          <form action="/auth/logout" method="post">
            <Button type="submit" variant="secondary">
              {t('logout')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
