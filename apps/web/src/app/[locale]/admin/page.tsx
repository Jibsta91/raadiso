import { ExternalLink } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { auditEntries, reportQueue } from '@/lib/api';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

/** Overview: what needs attention, for the roles the person has. */
export default async function AdminOverview({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, session] = await Promise.all([getTranslations('admin'), getSession()]);
  const roles = session.authenticated ? session.user.roles : [];
  const [queue, recent] = await Promise.all([
    canOpen('moderation', roles) ? reportQueue().catch(() => null) : null,
    canOpen('audit', roles) ? auditEntries({}).catch(() => null) : null,
  ]);
  const base = new URL(env.publicBaseUrl);
  const tools = [
    ...(roles.includes('operator') || roles.includes('platform-admin')
      ? [{ key: 'grafana', href: `${base.protocol}//grafana.${base.host}` }]
      : []),
    ...(roles.includes('platform-admin')
      ? [{ key: 'keycloak', href: `${base.protocol}//auth.${base.host}/admin/` }]
      : []),
  ];

  return (
    <div className="max-w-5xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">{t('overview.title')}</h1>
        <p className="text-muted-foreground">{t('overview.intro')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {queue ? (
          <Link
            href="/admin/moderation"
            className="space-y-1 rounded-3xl border bg-card p-5 hover:bg-accent"
            data-testid="admin-card-moderation"
          >
            <p className="text-sm text-muted-foreground">{t('overview.openReports')}</p>
            <p className="text-4xl font-bold tabular-nums">
              {queue.reduce((n, i) => n + i.count, 0)}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('overview.listings', { count: queue.length })}
            </p>
          </Link>
        ) : null}
        {recent ? (
          <Link
            href="/admin/audit"
            className="space-y-1 rounded-3xl border bg-card p-5 hover:bg-accent"
            data-testid="admin-card-audit"
          >
            <p className="text-sm text-muted-foreground">{t('overview.latestAction')}</p>
            <p className="truncate text-lg font-semibold">
              {recent.items[0]
                ? t(`audit.actions.${recent.items[0].action.replace(/\./g, '_')}` as never)
                : '–'}
            </p>
            <p className="text-sm text-muted-foreground">{t('overview.auditHint')}</p>
          </Link>
        ) : null}
      </div>
      {tools.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('overview.tools')}</h2>
          <ul className="flex flex-wrap gap-2">
            {tools.map((tool) => (
              <li key={tool.key}>
                <a
                  href={tool.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent"
                >
                  {t(`overview.toolNames.${tool.key}` as never)}
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
