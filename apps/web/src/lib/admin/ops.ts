import 'server-only';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Operations data for the console (ADR-0030): Prometheus (metrics the services already export),
 * Alertmanager (firing alerts) and the services' own readiness reports. Read-only, numbers about
 * the platform; the operations page is for operators and platform admins only.
 */

export interface Series {
  labels: Record<string, string>;
  points: number[];
}

async function prom<T>(path: string, params: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(`${env.prometheusUrl}/api/v1/${path}?${new URLSearchParams(params)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status: string; data: T };
    return body.status === 'success' ? body.data : null;
  } catch (error) {
    logger.warn({ err: error }, 'prometheus query failed');
    return null;
  }
}

/** An instant query: one value per series. */
export async function instant(
  query: string,
): Promise<Array<{ labels: Record<string, string>; value: number }>> {
  const data = await prom<{
    result: Array<{ metric: Record<string, string>; value: [number, string] }>;
  }>('query', { query });
  return (data?.result ?? []).map((r) => ({ labels: r.metric, value: Number(r.value[1]) }));
}

/** A range query over the last `minutes`, `points` samples per series (NaN as 0). */
export async function range(query: string, minutes = 60, points = 30): Promise<Series[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - minutes * 60;
  const step = Math.max(15, Math.floor((minutes * 60) / points));
  const data = await prom<{
    result: Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
  }>('query_range', { query, start: String(start), end: String(end), step: String(step) });
  return (data?.result ?? []).map((r) => {
    const byTime = new Map(r.values.map(([t, v]) => [t, Number(v)]));
    const pts: number[] = [];
    for (let t = start; t <= end; t += step) {
      const v = byTime.get(t);
      pts.push(v === undefined || Number.isNaN(v) ? 0 : v);
    }
    return { labels: r.metric, points: pts };
  });
}

export interface Alert {
  name: string;
  severity: string;
  summary: string;
  startsAt: string;
  service: string | null;
}

export async function firingAlerts(): Promise<Alert[] | null> {
  try {
    const res = await fetch(`${env.alertmanagerUrl}/api/v2/alerts?active=true&silenced=false`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const alerts = (await res.json()) as Array<{
      labels: Record<string, string>;
      annotations: Record<string, string>;
      startsAt: string;
    }>;
    return alerts.map((a) => ({
      name: a.labels.alertname ?? 'alert',
      severity: a.labels.severity ?? 'warning',
      summary: a.annotations.summary ?? a.annotations.description ?? '',
      startsAt: a.startsAt,
      service: a.labels.service_name ?? a.labels.job ?? null,
    }));
  } catch {
    return null;
  }
}

/** Our services (all NestJS, port 4000, /readyz reports each dependency). */
export const SERVICES = [
  'identity-bff',
  'admin-bff',
  'listings',
  'search',
  'media',
  'messaging',
  'notifications',
  'trust',
  'payments',
  'saved',
  'audit',
] as const;

export interface Readiness {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  ms: number;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

export async function readiness(): Promise<Readiness[]> {
  return Promise.all(
    SERVICES.map(async (service) => {
      const started = performance.now();
      try {
        const res = await fetch(`http://${service}:4000/readyz`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        const ms = Math.round(performance.now() - started);
        const body = (await res.json().catch(() => ({}))) as {
          checks?: Record<string, { status?: string; error?: string }>;
        };
        const checks = Object.entries(body.checks ?? {}).map(([name, c]) => ({
          name,
          ok: c.status === 'ok' || c.status === 'up',
          ...(c.error ? { detail: c.error.slice(0, 120) } : {}),
        }));
        return {
          service,
          status: res.ok ? 'ok' : checks.some((c) => c.ok) ? 'degraded' : 'down',
          ms,
          checks,
        } satisfies Readiness;
      } catch {
        return {
          service,
          status: 'down',
          ms: Math.round(performance.now() - started),
          checks: [],
        } satisfies Readiness;
      }
    }),
  );
}
