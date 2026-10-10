import {
  Activity,
  BellRing,
  Database,
  ExternalLink,
  Inbox,
  Layers,
  Mail,
  Search,
  ServerCrash,
} from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LiveRefresh } from '@/components/admin/live';
import { Ago } from '@/components/admin/time';
import {
  Empty,
  KeyValues,
  PageHeader,
  Panel,
  Pill,
  Sparkline,
  Stat,
  Table,
  td,
  Unavailable,
} from '@/components/admin/ui';
import {
  indexStatus,
  listingStats,
  notificationQueues,
  paymentStats,
  settle,
} from '@/lib/admin/api';
import { bytes, count, duration, percent } from '@/lib/admin/format';
import { firingAlerts, instant, range, readiness } from '@/lib/admin/ops';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('operations') };
}

const REQ = 'http_server_request_duration_seconds';
const Q = {
  rate: `sum by (service_name)(rate(${REQ}_count[5m]))`,
  errors: `sum by (service_name)(rate(${REQ}_count{http_response_status_code=~"5.."}[5m]))`,
  p95: `histogram_quantile(0.95, sum by (service_name, le)(rate(${REQ}_bucket[5m])))`,
  lag: 'sum by (group)(kafka_consumer_group_lag_sum_ratio)',
  dlq: 'sum(kafka_partition_current_offset_ratio{topic="raadi.dlq"}) - sum(kafka_partition_oldest_offset_ratio{topic="raadi.dlq"})',
  indexLag: `histogram_quantile(0.95, sum by (le)(rate(raadi_search_index_lag_seconds_bucket[15m])))`,
  logins: 'sum(increase(raadi_auth_login_total[1h]))',
};

/**
 * Operations (ADR-0030): the platform's health in one page for operators: each service's
 * readiness and dependencies, golden signals, event pipeline (consumer lag, dead letters), delivery
 * queues, search index freshness and firing alerts. Numbers only, no user data.
 */
export default async function OperationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('operations', session.user.roles)) notFound();
  const t = await getTranslations('admin.operations');

  const [
    ready,
    rate,
    errors,
    p95,
    rateSeries,
    lag,
    dlq,
    indexLag,
    logins,
    alerts,
    queues,
    index,
    listings,
    pay,
  ] = await Promise.all([
    readiness(),
    instant(Q.rate),
    instant(Q.errors),
    instant(Q.p95),
    range(Q.rate, 60, 30),
    instant(Q.lag),
    instant(Q.dlq),
    instant(Q.indexLag),
    instant(Q.logins),
    firingAlerts(),
    settle(notificationQueues()),
    settle(indexStatus()),
    settle(listingStats()),
    settle(paymentStats()),
  ]);

  const by = (rows: Array<{ labels: Record<string, string>; value: number }>, key: string) =>
    new Map(rows.map((r) => [r.labels[key] ?? '', r.value]));
  const rates = by(rate, 'service_name');
  const errs = by(errors, 'service_name');
  const lat = by(p95, 'service_name');
  const series = new Map(rateSeries.map((s) => [s.labels.service_name ?? '', s.points]));
  const down = ready.filter((r) => r.status !== 'ok');
  const totalLag = lag.reduce((n, l) => n + (Number.isFinite(l.value) ? l.value : 0), 0);
  const dead = Math.max(0, dlq[0]?.value ?? 0);
  const indexedActive = index?.byStatus.find((s) => s.status === 'active')?.count ?? null;
  const drift = indexedActive !== null && listings ? indexedActive - listings.active : null;
  const base = new URL(env.publicBaseUrl);
  const grafana = `${base.protocol}//grafana.${base.host}`;
  const services = [...new Set([...ready.map((r) => r.service), ...rates.keys()])].filter(
    (s) => s && !['mobile-web'].includes(s),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        intro={t('intro')}
        actions={
          <>
            <LiveRefresh seconds={15} />
            <a
              href={`${grafana}/d/raadi-overview`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-semibold hover:bg-accent"
            >
              Grafana
              <ExternalLink aria-hidden className="size-3" />
            </a>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="ops-stats">
        <Stat
          label={t('stats.services')}
          value={`${ready.length - down.length}/${ready.length}`}
          hint={
            down.length
              ? t('stats.down', { names: down.map((d) => d.service).join(', ') })
              : t('stats.allReady')
          }
          tone={down.length ? 'bad' : 'good'}
          icon={Activity}
          testId="ops-ready"
        />
        <Stat
          label={t('stats.alerts')}
          value={alerts ? alerts.length : '–'}
          hint={alerts?.length ? alerts[0]!.name : t('stats.noAlerts')}
          tone={alerts?.length ? 'bad' : 'good'}
          icon={BellRing}
          testId="ops-alerts"
        />
        <Stat
          label={t('stats.lag')}
          value={count(totalLag, locale)}
          hint={t('stats.lagHint', { groups: lag.length })}
          tone={totalLag > 100 ? 'bad' : 'muted'}
          icon={Layers}
        />
        <Stat
          label={t('stats.dlq')}
          value={count(dead, locale)}
          hint={t('stats.dlqHint')}
          tone={dead ? 'bad' : 'good'}
          icon={Inbox}
          testId="ops-dlq"
        />
        <Stat
          label={t('stats.logins')}
          value={count(Math.round(logins[0]?.value ?? 0), locale)}
          hint={t('stats.loginsHint')}
          icon={Database}
        />
      </div>

      <Panel title={t('health')} icon={Activity} testId="ops-health" bodyClassName="p-0">
        <Table
          head={[
            t('columns.service'),
            t('columns.status'),
            t('columns.dependencies'),
            t('columns.rate'),
            t('columns.errors'),
            t('columns.p95'),
            t('columns.trend'),
          ]}
        >
          {services.map((service) => {
            const r = ready.find((x) => x.service === service);
            const rps = rates.get(service) ?? 0;
            const errRate = rps > 0 ? (errs.get(service) ?? 0) / rps : 0;
            const p = lat.get(service);
            return (
              <tr key={service} data-testid="ops-service">
                <td className={`${td} font-mono text-xs font-semibold`}>{service}</td>
                <td className={td}>
                  {r ? (
                    <Pill
                      tone={r.status === 'ok' ? 'good' : r.status === 'degraded' ? 'warn' : 'bad'}
                      dot
                    >
                      {t(`status.${r.status}`)} · {r.ms} ms
                    </Pill>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className={td}>
                  <span className="flex flex-wrap gap-1">
                    {r?.checks.map((c) => (
                      <span
                        key={c.name}
                        title={c.detail ?? c.name}
                        className={`rounded-field px-1.5 py-0.5 font-mono text-xs ${c.ok ? 'bg-success/12 text-success' : 'bg-destructive/12 text-destructive'}`}
                      >
                        {c.name}
                      </span>
                    ))}
                  </span>
                </td>
                <td className={`${td} tabular-nums`}>{rps.toFixed(2)}/s</td>
                <td
                  className={`${td} tabular-nums ${errRate > 0.01 ? 'font-semibold text-destructive' : ''}`}
                >
                  {percent(errRate, locale)}
                </td>
                <td className={`${td} tabular-nums`}>
                  {p !== undefined && Number.isFinite(p) ? `${Math.round(p * 1000)} ms` : '–'}
                </td>
                <td className={`${td} w-32`}>
                  <Sparkline
                    values={series.get(service) ?? []}
                    tone={errRate > 0.01 ? 'bad' : 'primary'}
                  />
                </td>
              </tr>
            );
          })}
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('pipeline')} icon={Layers} testId="ops-pipeline">
          {lag.length === 0 ? (
            <Empty>{t('noMetrics')}</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {lag
                .sort((a, b) => b.value - a.value)
                .map((l) => (
                  <li key={l.labels.group} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{l.labels.group}</span>
                    <Pill tone={l.value > 100 ? 'bad' : l.value > 0 ? 'warn' : 'good'}>
                      {t('lag', { count: Math.round(l.value) })}
                    </Pill>
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            {dead ? t('dlqBody', { count: dead }) : t('dlqEmpty')}{' '}
            <a
              href={`${grafana}/explore?left=${encodeURIComponent(JSON.stringify({ datasource: 'loki', queries: [{ refId: 'A', expr: '{service_namespace="raadi"} |= "dead-lettered"' }], range: { from: 'now-24h', to: 'now' } }))}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary hover:underline"
            >
              {t('dlqLogs')}
            </a>
          </p>
        </Panel>

        <Panel title={t('delivery')} icon={Mail} testId="ops-delivery">
          {!queues ? (
            <Unavailable>{t('unavailable')}</Unavailable>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {queues.channels.map((c) => (
                  <div key={c.channel} className="space-y-1 rounded-card bg-muted p-3 text-sm">
                    <p className="font-semibold">{t(`channels.${c.channel}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('queue', { pending: c.pending, sent: c.sent24h, failed: c.failed24h })}
                    </p>
                    {c.oldestPendingAt ? (
                      <p className="text-xs text-muted-foreground">
                        {t('oldest')} <Ago at={c.oldestPendingAt} />
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              {queues.errors.length ? (
                <ul className="space-y-1.5 text-xs">
                  {queues.errors.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <Pill tone="bad">{e.count}×</Pill>
                      <span className="min-w-0 flex-1 truncate font-mono" title={e.error}>
                        {e.error}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t('noErrors')}</p>
              )}
            </div>
          )}
        </Panel>

        <Panel title={t('search')} icon={Search} testId="ops-search">
          {!index ? (
            <Unavailable>{t('unavailable')}</Unavailable>
          ) : (
            <KeyValues
              items={[
                [
                  t('index.alias'),
                  <span
                    key="a"
                    className="font-mono text-xs"
                  >{`${index.alias} (v${index.version})`}</span>,
                ],
                [t('index.documents'), count(index.documents, locale)],
                [t('index.size'), index.sizeBytes !== null ? bytes(index.sizeBytes, locale) : '–'],
                [
                  t('index.newest'),
                  index.newestUpdateAt ? <Ago key="n" at={index.newestUpdateAt} /> : '–',
                ],
                [
                  t('index.lag'),
                  indexLag[0] && Number.isFinite(indexLag[0].value)
                    ? duration(indexLag[0].value, locale)
                    : '–',
                ],
                [
                  t('index.drift'),
                  drift === null ? (
                    '–'
                  ) : (
                    <Pill key="d" tone={drift === 0 ? 'good' : 'warn'} testId="ops-drift">
                      {drift === 0 ? t('index.inSync') : t('index.off', { count: drift })}
                    </Pill>
                  ),
                ],
              ]}
            />
          )}
        </Panel>

        <Panel title={t('alerts')} icon={BellRing} testId="ops-alert-list">
          {alerts === null ? (
            <Unavailable>{t('unavailable')}</Unavailable>
          ) : alerts.length === 0 ? (
            <Empty icon={ServerCrash}>{t('noAlerts')}</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {alerts.map((a) => (
                <li key={`${a.name}-${a.startsAt}`} className="space-y-0.5">
                  <p className="flex items-center gap-2">
                    <Pill tone={a.severity === 'critical' ? 'bad' : 'warn'}>{a.severity}</Pill>
                    <span className="font-semibold">{a.name}</span>
                    <span className="ms-auto text-xs text-muted-foreground">
                      <Ago at={a.startsAt} />
                    </span>
                  </p>
                  {a.summary ? <p className="text-muted-foreground">{a.summary}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {pay ? (
            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              {t('payments', { stuck: pay.stuck })}
            </p>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
