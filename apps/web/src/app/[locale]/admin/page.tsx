import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Flag,
  MessagesSquare,
  Package,
  Server,
  Users,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LiveRefresh } from '@/components/admin/live';
import { Ago } from '@/components/admin/time';
import { Empty, PageHeader, Panel, Pill, Stat, type Tone } from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import {
  adminAudit,
  listingStats,
  messagingStats,
  notificationQueues,
  paymentStats,
  settle,
  userStats,
} from '@/lib/admin/api';
import { count, duration, nok, percent } from '@/lib/admin/format';
import { firingAlerts, range } from '@/lib/admin/ops';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

const ERROR_RATE =
  'sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_server_request_duration_seconds_count[5m])), 0.000001)';

/** Overview: today's numbers and what needs attention, for the roles the person has. */
export default async function AdminOverview({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, session] = await Promise.all([getTranslations('admin'), getSession()]);
  if (!session.authenticated) return null;
  const roles = session.user.roles;
  const ops = canOpen('operations', roles);
  const money = roles.some((r) => ['support', 'operator', 'platform-admin'].includes(r));

  const [listings, users, pay, msgs, mine, alerts, errors, queues] = await Promise.all([
    settle(listingStats()),
    canOpen('users', roles) ? settle(userStats()) : null,
    money ? settle(paymentStats()) : null,
    settle(messagingStats()),
    settle(adminAudit({ actor: session.user.id, limit: 6 })),
    ops ? firingAlerts() : null,
    ops ? range(ERROR_RATE, 60, 30) : null,
    ops ? settle(notificationQueues()) : null,
  ]);

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', timeZone: 'Europe/Oslo' }).format(
      new Date(),
    ),
  );
  const greeting =
    hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const firstName = (session.user.name ?? session.user.email).split(/[\s@]/)[0] ?? '';
  const errorPoints = errors?.[0]?.points ?? [];
  const errorNow = errorPoints.at(-1) ?? 0;
  const mod = listings?.moderation;
  const oldestHours = mod?.oldestAt ? (Date.now() - Date.parse(mod.oldestAt)) / 3_600_000 : 0;

  // What needs a person now, most urgent first.
  const attention: Array<{ tone: Tone; text: string; href?: string; testId: string }> = [];
  if (alerts?.length)
    attention.push({
      tone: 'bad',
      text: t('attention.alerts', { count: alerts.length }),
      href: '/admin/operations',
      testId: 'attention-alerts',
    });
  if (mod && canOpen('moderation', roles) && mod.listings > 0)
    attention.push({
      tone: oldestHours > 24 ? 'bad' : 'warn',
      text: t('attention.reports', {
        count: mod.listings,
        age: duration((Date.now() - Date.parse(mod.oldestAt!)) / 1000, locale),
      }),
      href: '/admin/moderation',
      testId: 'attention-reports',
    });
  if (pay && pay.stuck > 0)
    attention.push({
      tone: 'warn',
      text: t('attention.stuck', { count: pay.stuck }),
      href: canOpen('orders', roles) ? '/admin/orders?status=created' : undefined,
      testId: 'attention-stuck',
    });
  for (const q of queues?.channels ?? [])
    if (q.failed24h > 0)
      attention.push({
        tone: 'warn',
        text: t('attention.delivery', { count: q.failed24h, channel: t(`channels.${q.channel}`) }),
        href: '/admin/operations',
        testId: `attention-${q.channel}`,
      });
  if (ops && errorNow > 0.02)
    attention.push({
      tone: 'bad',
      text: t('attention.errors', { rate: percent(errorNow, locale) }),
      href: '/admin/operations',
      testId: 'attention-errors',
    });

  const base = new URL(env.publicBaseUrl);
  const tools = [
    ...(ops ? [{ key: 'grafana', href: `${base.protocol}//grafana.${base.host}` }] : []),
    ...(roles.includes('platform-admin')
      ? [{ key: 'keycloak', href: `${base.protocol}//auth.${base.host}/admin/` }]
      : []),
    { key: 'website', href: env.publicBaseUrl },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<span>{t('overview.title')}</span>}
        title={t(`overview.greeting.${greeting}`, { name: firstName })}
        intro={t('overview.intro')}
        actions={<LiveRefresh seconds={30} />}
      />

      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3"
        data-testid="overview-stats"
      >
        {mod && canOpen('moderation', roles) ? (
          <Stat
            label={t('overview.openReports')}
            value={count(mod.listings, locale)}
            hint={
              mod.medianHandleSeconds !== null
                ? t('overview.median', { time: duration(mod.medianHandleSeconds, locale) })
                : t('overview.handled', { count: mod.handled7d })
            }
            trend={mod.handled.map((d) => d.count)}
            tone={mod.listings ? 'bad' : 'good'}
            icon={Flag}
            href="/admin/moderation"
            testId="admin-card-moderation"
          />
        ) : null}
        {listings ? (
          <Stat
            label={t('overview.activeListings')}
            value={count(listings.active, locale)}
            hint={t('overview.newToday', { count: listings.created.at(-1)?.count ?? 0 })}
            trend={listings.created.map((d) => d.count)}
            icon={Package}
            href={canOpen('listings', roles) ? '/admin/listings' : undefined}
            testId="stat-listings"
          />
        ) : null}
        {users ? (
          <Stat
            label={t('overview.users')}
            value={count(users.total, locale)}
            hint={t('overview.signups', {
              count: users.signups.reduce((n, d) => n + d.count, 0),
            })}
            trend={users.active.map((d) => d.count)}
            tone="good"
            icon={Users}
            href="/admin/users"
            testId="stat-users"
          />
        ) : null}
        {pay ? (
          <Stat
            label={t('overview.revenue')}
            value={nok(pay.capturedOre30d, locale)}
            hint={t('overview.orders', { count: pay.orders30d })}
            trend={pay.revenue.map((d) => d.ore)}
            tone="good"
            icon={CreditCard}
            href={canOpen('orders', roles) ? '/admin/orders' : undefined}
            testId="stat-revenue"
          />
        ) : null}
        {ops ? (
          <Stat
            label={t('overview.errorRate')}
            value={percent(errorNow, locale)}
            hint={t('overview.lastHour')}
            trend={errorPoints}
            tone={errorNow > 0.01 ? 'bad' : 'muted'}
            icon={Server}
            href="/admin/operations"
            testId="stat-errors"
          />
        ) : null}
        {msgs ? (
          <Stat
            label={t('overview.messages')}
            value={count(msgs.messages.at(-1)?.count ?? 0, locale)}
            hint={t('overview.conversations', { count: msgs.conversations7d })}
            trend={msgs.messages.map((d) => d.count)}
            icon={MessagesSquare}
            testId="stat-messages"
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel title={t('overview.attention')} icon={BellRing} testId="overview-attention">
          {attention.length === 0 ? (
            <Empty icon={CheckCircle2} testId="attention-clear">
              {t('overview.allClear')}
            </Empty>
          ) : (
            <ul className="space-y-2">
              {attention.map((a) => (
                <li key={a.testId} data-testid={a.testId}>
                  {a.href ? (
                    <Link
                      href={a.href}
                      prefetch={false}
                      className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm hover:bg-accent"
                    >
                      <AlertTriangle
                        aria-hidden
                        className={`size-4 shrink-0 ${a.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground'}`}
                      />
                      <span className="flex-1">{a.text}</span>
                      <ArrowUpRight aria-hidden className="size-4 text-muted-foreground" />
                    </Link>
                  ) : (
                    <p className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm">
                      <AlertTriangle aria-hidden className="size-4 shrink-0" />
                      {a.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {alerts?.length ? (
            <ul className="mt-3 space-y-1.5 text-sm" data-testid="overview-alerts">
              {alerts.slice(0, 5).map((a) => (
                <li key={`${a.name}-${a.startsAt}`} className="flex items-center gap-2">
                  <Pill tone={a.severity === 'critical' ? 'bad' : 'warn'}>{a.severity}</Pill>
                  <span className="font-medium">{a.name}</span>
                  <span className="truncate text-muted-foreground">{a.summary}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel
          title={t('overview.myActivity')}
          icon={Clock}
          testId="overview-activity"
          actions={
            canOpen('audit', roles) ? (
              <Link
                href={`/admin/audit?actor=${session.user.id}`}
                prefetch={false}
                className="text-xs font-semibold text-primary hover:underline"
              >
                {t('overview.all')}
              </Link>
            ) : null
          }
        >
          {!mine?.items.length ? (
            <Empty>{t('overview.noActivity')}</Empty>
          ) : (
            <ol className="relative space-y-3 border-l pl-4">
              {mine.items.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
                  <p className="font-medium">
                    {t(`audit.actionNames.${e.action.replace(/\./g, '_')}` as never)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`audit.targets.${e.target.type}` as never)} · <Ago at={e.at} />
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('overview.tools')}</h2>
        <ul className="flex flex-wrap gap-2">
          {tools.map((tool) => (
            <li key={tool.key}>
              <a
                href={tool.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent"
              >
                {t(`overview.toolNames.${tool.key}` as never)}
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
