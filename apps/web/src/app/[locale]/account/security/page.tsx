import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from '@raadi/ui';
import {
  Fingerprint,
  KeyRound,
  Laptop,
  Lock,
  Monitor,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { SecurityAction } from '@/components/account/security-action';
import { Link } from '@/i18n/navigation';
import { mySecurity } from '@/lib/api';
import { getSession } from '@/lib/session';
import { ClientMessages } from '@/components/client-messages';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('security');
  return { title: t('title'), robots: { index: false } };
}

const deviceIcon = (s: { mobile: boolean; apps: string[]; os: string }): LucideIcon =>
  s.apps.includes('app') || s.mobile
    ? Smartphone
    : /mac|windows|linux/i.test(s.os)
      ? Laptop
      : Monitor;

/**
 * The account's security centre (ADR-0031): where you are signed in (sign out one device or all
 * others), how you sign in (passkeys, authenticator app, password) and a short checkup. Everything
 * runs through Keycloak's Account API with the user's own token; changes go through Keycloak's
 * own pages and come back here.
 */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const path = `/${locale}/account/security`;
  const session = await getSession();
  if (!session.authenticated) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(path)}&locale=${locale}`);
  }
  const [t, format, overview] = await Promise.all([
    getTranslations('security'),
    getFormatter(),
    mySecurity().catch(() => null),
  ]);
  const action = (name: string) =>
    `/auth/login?action=${name}&returnTo=${encodeURIComponent(path)}&locale=${locale}`;
  const ago = (iso: string) => format.relativeTime(new Date(iso), new Date());

  if (!overview) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Alert variant="danger">{t('unavailable')}</Alert>
      </div>
    );
  }

  const method = (type: string) => overview.methods.find((m) => m.type === type);
  const passkeys = method('webauthn-passwordless')?.credentials ?? [];
  const otp = method('otp')?.credentials ?? [];
  const others = overview.sessions.filter((s) => !s.current);
  // A short checkup: a passkey is the strongest step, an authenticator next, few open sessions.
  const checks = [
    { key: 'passkey', done: passkeys.length > 0, weight: 50 },
    { key: 'otp', done: otp.length > 0 || passkeys.length > 0, weight: 30 },
    { key: 'sessions', done: others.length <= 3, weight: 20 },
  ];
  const score = checks.reduce((n, c) => n + (c.done ? c.weight : 0), 0);
  const level = score >= 80 ? 'strong' : score >= 50 ? 'good' : 'basic';

  return (
    <ClientMessages set="security">
      <div className="mx-auto max-w-2xl space-y-6" data-testid="security-page">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/account" className="hover:underline">
              ← {t('back')}
            </Link>
          </p>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>

        <Card data-testid="security-checkup">
          <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
            <div
              className="relative flex size-24 shrink-0 items-center justify-center rounded-full"
              style={{
                background: `conic-gradient(var(--${level === 'basic' ? 'destructive' : level === 'good' ? 'primary' : 'success'}) ${score * 3.6}deg, var(--muted) 0deg)`,
              }}
              role="img"
              aria-label={t('scoreLabel', { score })}
            >
              <span className="flex size-[4.75rem] flex-col items-center justify-center rounded-full bg-card">
                <span className="text-xl font-bold tabular-nums">{score}</span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  / 100
                </span>
              </span>
            </div>
            <div className="space-y-2">
              <p className="text-lg font-semibold" data-testid="security-level">
                {t(`levels.${level}`)}
              </p>
              <ul className="space-y-1 text-sm">
                {checks.map((c) => (
                  <li
                    key={c.key}
                    className={cn(
                      'flex items-center gap-2',
                      c.done ? 'text-success' : 'text-muted-foreground',
                    )}
                  >
                    <ShieldCheck aria-hidden className={cn('size-4', !c.done && 'opacity-40')} />
                    {t(`checks.${c.key}${c.done ? 'Done' : 'Todo'}`, { count: others.length })}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint aria-hidden className="size-5" />
              {t('passkeys.title')}
              <Badge variant="outline">{t('recommended')}</Badge>
            </CardTitle>
            <CardDescription>{t('passkeys.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {passkeys.length ? (
              <ul className="divide-y rounded-card border" data-testid="passkeys">
                {passkeys.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span>
                      <span className="block font-medium">{p.label ?? t('passkeys.unnamed')}</span>
                      {p.createdAt ? (
                        <span className="block text-xs text-muted-foreground">
                          {t('added', { when: ago(p.createdAt) })}
                        </span>
                      ) : null}
                    </span>
                    <SecurityAction
                      kind="credential"
                      id={p.id}
                      label={t('remove')}
                      confirm={t('passkeys.confirmRemove')}
                      variant="ghost"
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <Button asChild data-testid="add-passkey">
              <a href={action('webauthn-register-passwordless')}>{t('passkeys.add')}</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound aria-hidden className="size-5" />
              {t('otp.title')}
            </CardTitle>
            <CardDescription>{t('otp.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            {otp.length ? (
              <>
                <span className="text-sm">
                  {t('otp.on', { count: otp.length })}
                  {otp[0]?.createdAt ? ` · ${t('added', { when: ago(otp[0].createdAt) })}` : ''}
                </span>
                <SecurityAction
                  kind="credential"
                  id={otp[0]!.id}
                  label={t('remove')}
                  confirm={t('otp.confirmRemove')}
                  variant="ghost"
                />
              </>
            ) : (
              <Button asChild variant="outline" data-testid="add-otp">
                <a href={action('CONFIGURE_TOTP')}>{t('otp.add')}</a>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock aria-hidden className="size-5" />
              {t('password.title')}
            </CardTitle>
            <CardDescription>
              {method('password')?.credentials[0]?.createdAt
                ? t('password.changed', {
                    when: ago(method('password')!.credentials[0]!.createdAt!),
                  })
                : t('password.hint')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" data-testid="change-password">
              <a href={action('UPDATE_PASSWORD')}>{t('password.change')}</a>
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="security-sessions">
          <CardHeader>
            <CardTitle>{t('sessions.title')}</CardTitle>
            <CardDescription>{t('sessions.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="divide-y rounded-card border">
              {overview.sessions.map((s) => {
                const Icon = deviceIcon(s);
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 p-3 text-sm"
                    data-testid="security-session"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {t('sessions.what', { browser: s.browser, os: s.os })}
                        {s.current ? (
                          <Badge data-testid="this-device">{t('sessions.thisDevice')}</Badge>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {[
                          s.apps
                            .map((a) => (t.has(`apps.${a}`) ? t(`apps.${a}` as never) : a))
                            .join(', '),
                          s.ip,
                          t('sessions.active', { when: ago(s.lastAccessAt) }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {s.current ? null : (
                      <SecurityAction
                        kind="session"
                        id={s.id}
                        label={t('sessions.signOut')}
                        variant="ghost"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            {others.length ? (
              <SecurityAction
                kind="others"
                label={t('sessions.signOutOthers', { count: others.length })}
                confirm={t('sessions.confirmOthers')}
                variant="secondary"
                testId="sign-out-others"
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </ClientMessages>
  );
}
