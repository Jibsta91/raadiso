import { logger } from './logger';

export interface ComponentStatus {
  name: string;
  group: 'app' | 'platform' | 'observability';
  ok: boolean;
  latencyMs: number;
}

// Internal readiness endpoints. Only up/down and latency are shown publicly.
const CHECKS: Array<Omit<ComponentStatus, 'ok' | 'latencyMs'> & { url: string }> = [
  { name: 'identity-bff', group: 'app', url: 'http://identity-bff:4000/readyz' },
  { name: 'listings', group: 'app', url: 'http://listings:4000/readyz' },
  { name: 'search', group: 'app', url: 'http://search:4000/readyz' },
  { name: 'media', group: 'app', url: 'http://media:4000/readyz' },
  { name: 'messaging', group: 'app', url: 'http://messaging:4000/readyz' },
  { name: 'notifications', group: 'app', url: 'http://notifications:4000/readyz' },
  { name: 'trust', group: 'app', url: 'http://trust:4000/readyz' },
  { name: 'payments', group: 'app', url: 'http://payments:4000/readyz' },
  { name: 'Keycloak', group: 'platform', url: 'http://keycloak:9000/health/ready' },
  { name: 'OpenBao', group: 'platform', url: 'http://openbao:8200/v1/sys/health' },
  { name: 'Kafka Connect (Debezium)', group: 'platform', url: 'http://kafka-connect:8083/' },
  { name: 'Apicurio Registry', group: 'platform', url: 'http://apicurio:9000/health/ready' },
  { name: 'OpenFGA', group: 'platform', url: 'http://openfga:8080/healthz' },
  { name: 'OPA', group: 'platform', url: 'http://opa:8181/health' },
  { name: 'imgproxy', group: 'platform', url: 'http://imgproxy:8080/health' },
  { name: 'Image cache', group: 'platform', url: 'http://img-cache:8080/healthz' },
  { name: 'SeaweedFS', group: 'platform', url: 'http://seaweedfs:8333/healthz' },
  { name: 'Grafana', group: 'observability', url: 'http://grafana:3000/api/health' },
  { name: 'Prometheus', group: 'observability', url: 'http://prometheus:9090/-/ready' },
  { name: 'Alertmanager', group: 'observability', url: 'http://alertmanager:9093/-/ready' },
  { name: 'Loki', group: 'observability', url: 'http://loki:3100/ready' },
  { name: 'Tempo', group: 'observability', url: 'http://tempo:3200/ready' },
  { name: 'OpenTelemetry Collector', group: 'observability', url: 'http://otel-collector:13133/' },
];

export async function platformStatus(): Promise<ComponentStatus[]> {
  return Promise.all(
    CHECKS.map(async ({ url, ...c }) => {
      const started = performance.now();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
        return { ...c, ok: res.ok, latencyMs: Math.round(performance.now() - started) };
      } catch (error) {
        logger.debug({ err: error, component: c.name }, 'status check failed');
        return { ...c, ok: false, latencyMs: Math.round(performance.now() - started) };
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Journeys and SLOs (ADR-0031), from Prometheus: synthetic probes of the main journeys every 30 s
// and the SLO recording rules. Public: ratios only, never request details.

const HOURS = 7 * 24;

async function promQuery<T>(path: string, params: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(
      `${process.env.PROMETHEUS_URL ?? 'http://prometheus:9090'}/api/v1/${path}?${new URLSearchParams(params)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { status: string; data: T };
    return body.status === 'success' ? body.data : null;
  } catch (error) {
    logger.debug({ err: error }, 'status: prometheus unavailable');
    return null;
  }
}

type Vector = { result: Array<{ metric: Record<string, string>; value: [number, string] }> };
type Matrix = {
  result: Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
};

export interface JourneyHistory {
  journey: string;
  /** Share of passing probes per hour, oldest first; null where there is no data. */
  hours: Array<number | null>;
  /** Share of passing probes over the 7 days (null without data). */
  uptime: number | null;
  /** The latest probe passed. */
  up: boolean;
}

export async function journeyHistory(): Promise<{
  end: number;
  journeys: JourneyHistory[];
} | null> {
  // The last bucket ends now (not at the last full hour), so a stack started minutes ago has data.
  const end = Math.floor(Date.now() / 1000);
  const start = end - (HOURS - 1) * 3600;
  const [hourly, week, now] = await Promise.all([
    promQuery<Matrix>('query_range', {
      query: 'avg by (journey) (avg_over_time(probe_success{job="journeys"}[1h]))',
      start: String(start),
      end: String(end),
      step: '3600',
    }),
    promQuery<Vector>('query', {
      query:
        'sum by (journey) (sum_over_time(probe_success{job="journeys"}[7d])) / sum by (journey) (count_over_time(probe_success{job="journeys"}[7d]))',
    }),
    promQuery<Vector>('query', { query: 'max by (journey) (probe_success{job="journeys"})' }),
  ]);
  if (!now) return null;
  const uptime = new Map((week?.result ?? []).map((r) => [r.metric.journey!, Number(r.value[1])]));
  const hours = new Map(
    (hourly?.result ?? []).map((r) => [
      r.metric.journey!,
      new Map(r.values.map(([t, v]) => [t, Number(v)])),
    ]),
  );
  // Every journey probed now is listed, with or without history.
  const journeys = now.result
    .map((r) => {
      const journey = r.metric.journey!;
      const byTime = hours.get(journey);
      return {
        journey,
        hours: Array.from({ length: HOURS }, (_, i) => byTime?.get(start + i * 3600) ?? null),
        uptime: uptime.get(journey) ?? null,
        up: r.value[1] === '1',
      };
    })
    .sort((a, b) => JOURNEY_ORDER.indexOf(a.journey) - JOURNEY_ORDER.indexOf(b.journey));
  return { end, journeys };
}

const JOURNEY_ORDER = ['home', 'search_page', 'search_api', 'sign_in', 'console', 'app_web'];

export interface SloSummary {
  slo: string;
  objective: number;
  /** Attainment over 7 days (null without traffic). */
  attained: number | null;
  /** Error budget left: 1 untouched, 0 spent, negative overspent. */
  budget: number | null;
}

export async function sloSummary(): Promise<SloSummary[] | null> {
  const [objectives, attained, budget] = await Promise.all([
    promQuery<Vector>('query', { query: 'slo:objective:ratio' }),
    promQuery<Vector>('query', { query: '1 - slo:sli_error:ratio_rate7d' }),
    promQuery<Vector>('query', { query: 'slo:error_budget_remaining:ratio' }),
  ]);
  if (!objectives) return null;
  const by = (v: Vector | null) =>
    new Map((v?.result ?? []).map((r) => [r.metric.slo!, Number(r.value[1])]));
  const a = by(attained);
  const b = by(budget);
  return objectives.result
    .map((r) => ({
      slo: r.metric.slo!,
      objective: Number(r.value[1]),
      attained: a.get(r.metric.slo!) ?? null,
      budget: b.get(r.metric.slo!) ?? null,
    }))
    .sort((x, y) => SLO_ORDER.indexOf(x.slo) - SLO_ORDER.indexOf(y.slo));
}

const SLO_ORDER = [
  'journeys',
  'web_availability',
  'api_availability',
  'page_latency',
  'search_latency',
  'sign_in',
];
