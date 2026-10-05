import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@raadi/ui';
import { CircleCheck, CircleX } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { journeyHistory, platformStatus, sloSummary } from '@/lib/status';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('status');
  return { title: t('title') };
}

/** Colour of one hour on the uptime strip. */
const hourTone = (v: number | null) =>
  v === null
    ? 'bg-muted'
    : v >= 0.999
      ? 'bg-success'
      : v >= 0.95
        ? 'bg-highlight dark:bg-highlight/70'
        : 'bg-destructive';

/**
 * The public status page (ADR-0031): the main journeys as visitors take them (synthetic probes,
 * hour by hour for 7 days), how well each service level objective is met, and each component's
 * live readiness.
 */
export default async function StatusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, format, components, history, slos] = await Promise.all([
    getTranslations('status'),
    getFormatter(),
    platformStatus(),
    journeyHistory(),
    sloSummary(),
  ]);
  const journeys = history?.journeys ?? null;
  const componentsOk = components.every((c) => c.ok);
  const journeysOk = journeys?.every((j) => j.up) ?? true;
  const state = componentsOk && journeysOk ? 'ok' : journeysOk ? 'partial' : 'down';
  const groups = ['app', 'platform', 'observability'] as const;
  const pct = (v: number) =>
    format.number(v, { style: 'percent', maximumFractionDigits: v >= 0.999 && v < 1 ? 2 : 1 });
  const hourLabel = (i: number) => {
    const at = new Date(((history?.end ?? Date.now() / 1000) - (167 - i) * 3600) * 1000);
    return format.dateTime(at, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div
        role="status"
        data-testid="overall-status"
        data-state={state}
        className={cn(
          'flex items-center gap-3 rounded-2xl p-4 font-semibold',
          state === 'ok' && 'bg-success text-success-foreground',
          state === 'partial' && 'bg-highlight text-highlight-foreground',
          state === 'down' && 'bg-destructive text-destructive-foreground',
        )}
      >
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-50" />
          <span className="relative inline-flex size-2.5 rounded-full bg-current" />
        </span>
        {state === 'ok' ? t('allOk') : state === 'partial' ? t('degraded') : t('outage')}
      </div>

      <section className="space-y-4" data-testid="status-journeys">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold">{t('journeysTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('journeysHint')}</p>
        </div>
        {!journeys ? (
          <p className="text-sm text-muted-foreground">{t('noHistory')}</p>
        ) : (
          <ul className="divide-y rounded-3xl border bg-card">
            {journeys.map((j) => (
              <li key={j.journey} className="space-y-2 p-4" data-testid="status-journey">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-semibold">
                    {j.up ? (
                      <CircleCheck aria-hidden className="size-4 text-success" />
                    ) : (
                      <CircleX aria-hidden className="size-4 text-destructive" />
                    )}
                    {t(`journeys.${j.journey}` as never)}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {j.uptime === null ? '–' : t('uptime', { value: pct(j.uptime) })}
                  </span>
                </div>
                <div
                  className="flex h-8 gap-px"
                  role="img"
                  aria-label={t('stripLabel', { journey: t(`journeys.${j.journey}` as never) })}
                >
                  {j.hours.map((v, i) => (
                    <span
                      key={i}
                      title={`${hourLabel(i)} · ${v === null ? t('noData') : pct(v)}`}
                      className={cn(
                        'flex-1 rounded-[2px] first:rounded-l-md last:rounded-r-md',
                        hourTone(v),
                      )}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{t('daysAgo')}</span>
                  <span>{t('now')}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {slos?.length ? (
        <section className="space-y-4" data-testid="status-slos">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-bold">{t('slosTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('slosHint')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slos.map((s) => {
              const budget = s.budget === null ? null : Math.max(-1, Math.min(1, s.budget));
              const met = s.attained === null || s.attained >= s.objective;
              return (
                <div
                  key={s.slo}
                  className="space-y-2 rounded-2xl border bg-card p-4"
                  data-testid="status-slo"
                >
                  <p className="text-sm font-semibold">{t(`slos.${s.slo}` as never)}</p>
                  <p className="flex items-baseline gap-2">
                    <span className="font-display text-2xl font-bold tabular-nums">
                      {s.attained === null ? '–' : pct(s.attained)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('objective', { value: pct(s.objective) })}
                    </span>
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        !met
                          ? 'bg-destructive'
                          : (budget ?? 1) < 0.25
                            ? 'bg-highlight'
                            : 'bg-success',
                      )}
                      style={{ width: `${Math.max(0, (budget ?? 1) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {budget === null
                      ? t('noTraffic')
                      : t('budget', { value: pct(Math.max(0, budget)) })}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-bold">{t('componentsTitle')}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {groups.map((group) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle>{t(`groups.${group}`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {components
                    .filter((c) => c.group === group)
                    .map((c) => (
                      <li key={c.name} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2">
                          {c.ok ? (
                            <CircleCheck aria-hidden className="size-4 text-success" />
                          ) : (
                            <CircleX aria-hidden className="size-4 text-destructive" />
                          )}
                          {c.name}
                        </span>
                        <Badge variant={c.ok ? 'outline' : 'destructive'}>
                          {c.ok ? t('latency', { ms: c.latencyMs }) : t('down')}
                        </Badge>
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
