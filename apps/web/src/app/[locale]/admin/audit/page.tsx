import { Download, ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Ago } from '@/components/admin/time';
import {
  Avatar,
  Bars,
  Empty,
  Field,
  FilterBar,
  inputCls,
  PageHeader,
  Panel,
  Pill,
  Unavailable,
} from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import { adminAudit, type AuditQuery, auditStats, settle, staffNames } from '@/lib/admin/api';
import { AUDIT_ACTIONS, AUDIT_TARGETS, targetHref } from '@/lib/admin/audit';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('audit') };
}

/** Message key of an action ("listing.remove" → "listing_remove": dots mean nesting to next-intl). */
const actionKey = (action: string) => `actions.${action.replace(/\./g, '_')}`;
const nameKey = (action: string) => `actionNames.${action.replace(/\./g, '_')}`;

/** The audit log (ADR-0028/0030): every staff action, newest first, filterable, exportable. */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('audit', session.user.roles)) notFound();
  const [t, format] = await Promise.all([getTranslations('admin.audit'), getFormatter()]);
  const filters: AuditQuery = Object.fromEntries(
    (['actor', 'action', 'targetType', 'targetId', 'before'] as const)
      .map((k) => [k, sp[k]?.trim()])
      .filter(([, v]) => v),
  );
  const [page, stats] = await Promise.all([
    settle(adminAudit({ ...filters, limit: 50 })),
    settle(auditStats(14)),
  ]);
  const names = await staffNames([
    ...(page?.items.map((e) => e.actor.id) ?? []),
    ...(stats?.actors.map((a) => a.id) ?? []),
  ]);
  const query = (extra: Record<string, string | undefined>) =>
    new URLSearchParams(
      Object.entries({ ...filters, ...extra }).filter(([, v]) => v) as [string, string][],
    ).toString();
  const last = page?.items.at(-1);

  // Group entries by day for the timeline.
  const days = new Map<string, NonNullable<typeof page>['items']>();
  for (const e of page?.items ?? []) {
    const day = e.at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        intro={t('intro')}
        actions={
          <a
            href={`/${locale}/admin/audit/export?${query({ before: undefined })}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-accent"
            data-testid="audit-export"
          >
            <Download aria-hidden className="size-4" />
            {t('export')}
          </a>
        }
      />
      {stats ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
          <Panel title={t('stats.perDay', { total: stats.total })} bodyClassName="p-3">
            <Bars
              values={stats.days.map((d) => d.count)}
              labels={stats.days.map((d) => d.day)}
              className="h-20"
            />
          </Panel>
          <Panel title={t('stats.actions')}>
            <ul className="flex flex-wrap gap-1.5">
              {stats.actions.map((a) => (
                <li key={a.action}>
                  <Link
                    href={`/admin/audit?${query({ action: a.action, before: undefined })}`}
                    prefetch={false}
                  >
                    <Pill tone={filters.action === a.action ? 'ink' : 'neutral'}>
                      {t(nameKey(a.action) as never)} · {a.count}
                    </Pill>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={t('stats.actors')}>
            <ul className="space-y-1.5 text-sm">
              {stats.actors.slice(0, 5).map((a) => {
                const who = names.get(a.id);
                return (
                  <li key={a.id}>
                    <Link
                      href={`/admin/audit?${query({ actor: a.id, before: undefined })}`}
                      prefetch={false}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Avatar name={who?.name ?? who?.email ?? '?'} id={a.id} size="sm" />
                      <span className="flex-1 truncate">
                        {who?.name ?? who?.email ?? a.id.slice(0, 8)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{a.count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      ) : null}

      <FilterBar testId="audit-filters">
        <Field label={t('filters.action')}>
          <select name="action" defaultValue={filters.action ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(nameKey(a) as never)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filters.targetType')}>
          <select name="targetType" defaultValue={filters.targetType ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            {AUDIT_TARGETS.map((x) => (
              <option key={x} value={x}>
                {t(`targets.${x}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filters.targetId')}>
          <input
            name="targetId"
            defaultValue={filters.targetId}
            className={`${inputCls} w-72 font-mono`}
          />
        </Field>
        <Field label={t('filters.actor')}>
          <input
            name="actor"
            defaultValue={filters.actor}
            className={`${inputCls} w-72 font-mono`}
          />
        </Field>
        <button
          type="submit"
          className="h-9 rounded-full bg-ink px-4 text-sm font-semibold text-ink-foreground"
        >
          {t('filters.apply')}
        </button>
        {Object.keys(filters).length ? (
          <Link
            href="/admin/audit"
            prefetch={false}
            className="pb-2 text-sm text-primary hover:underline"
          >
            {t('filters.clear')}
          </Link>
        ) : null}
      </FilterBar>

      {!page ? (
        <Unavailable>{t('unavailable')}</Unavailable>
      ) : page.items.length === 0 ? (
        <Empty icon={ScrollText} testId="audit-empty">
          {t('empty')}
        </Empty>
      ) : (
        <div className="space-y-6" data-testid="audit-table">
          {[...days.entries()].map(([day, entries]) => (
            <section key={day} className="space-y-2">
              <h2 className="sticky top-0 z-10 bg-background/90 py-1 font-sans text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                {format.dateTime(new Date(`${day}T12:00:00Z`), { dateStyle: 'full' })}
              </h2>
              <ol className="divide-y rounded-2xl border bg-card">
                {entries.map((e) => {
                  const who = names.get(e.actor.id);
                  const href = targetHref(e.target.type, e.target.id);
                  return (
                    <li key={e.id} className="flex gap-3 p-3 text-sm" data-testid="audit-entry">
                      <Avatar name={who?.name ?? who?.email ?? '?'} id={e.actor.id} size="sm" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <Link
                            href={`/admin/audit?${query({ actor: e.actor.id, before: undefined })}`}
                            prefetch={false}
                            className="font-semibold hover:underline"
                          >
                            {who?.name ?? who?.email ?? e.actor.id.slice(0, 8)}
                          </Link>
                          <span>{t(actionKey(e.action) as never)}</span>
                          <span className="text-muted-foreground">
                            {t(`targets.${e.target.type}` as never)}
                          </span>
                          {href ? (
                            <Link
                              href={href}
                              prefetch={false}
                              className="font-mono text-xs text-primary hover:underline"
                              title={e.target.id}
                            >
                              {e.target.id.slice(0, 8)}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs" title={e.target.id}>
                              {e.target.id.slice(0, 8)}
                            </span>
                          )}
                        </p>
                        {e.reason ? <p className="text-subtle-foreground">“{e.reason}”</p> : null}
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Ago at={e.at} />
                          <span>· {e.source.replace('urn:raadi:', '')}</span>
                          {e.actor.roles.map((r) => (
                            <Pill key={r} tone="neutral">
                              {r}
                            </Pill>
                          ))}
                          {Object.entries(e.details ?? {}).map(([k, v]) => (
                            <Pill key={k} tone="info">
                              {k}: {Array.isArray(v) ? v.join(', ') || '–' : String(v)}
                            </Pill>
                          ))}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
      {page?.hasMore && last ? (
        <Link
          href={`/admin/audit?${query({ before: last.at })}`}
          prefetch={false}
          className="font-semibold text-primary hover:underline"
        >
          {t('older')} →
        </Link>
      ) : null}
    </div>
  );
}
