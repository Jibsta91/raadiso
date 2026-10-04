import { Button } from '@raadi/ui';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { auditEntries, type AuditFilters, ServiceUnavailableError } from '@/lib/api';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

const ACTIONS = ['listing.remove', 'reports.dismiss', 'payment.refund'] as const;
const TARGETS = ['listing', 'order', 'user', 'review', 'report', 'conversation', 'system'] as const;

/** Message key of an action ("listing.remove" → "listing_remove": dots mean nesting to next-intl). */
const actionKey = (action: string) => `actions.${action.replace(/\./g, '_')}`;

const short = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

/** The audit log (ADR-0028): every staff action, newest first, filterable (platform admins). */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('audit', session.user.roles)) notFound();
  const [t, format] = await Promise.all([getTranslations('admin.audit'), getFormatter()]);
  const filters: AuditFilters = Object.fromEntries(
    (['actor', 'action', 'targetType', 'targetId', 'before'] as const)
      .map((k) => [k, query[k]?.trim()])
      .filter(([, v]) => v),
  );
  let page;
  try {
    page = await auditEntries(filters);
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
        {t('unavailable')}
      </div>
    );
  }
  if (!page) notFound();
  const last = page.items.at(-1);
  const older = new URLSearchParams(
    Object.entries({ ...filters, before: last?.at }).filter(([, v]) => v) as [string, string][],
  );

  return (
    <div className="max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="audit-filters">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('filters.action')}</span>
          <select
            name="action"
            defaultValue={filters.action ?? ''}
            className="field h-10 border-input px-3"
          >
            <option value="">{t('filters.any')}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(actionKey(a) as never)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('filters.targetType')}</span>
          <select
            name="targetType"
            defaultValue={filters.targetType ?? ''}
            className="field h-10 border-input px-3"
          >
            <option value="">{t('filters.any')}</option>
            {TARGETS.map((x) => (
              <option key={x} value={x}>
                {t(`targets.${x}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('filters.targetId')}</span>
          <input
            name="targetId"
            defaultValue={filters.targetId}
            className="field h-10 w-72 border-input px-3"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('filters.actor')}</span>
          <input
            name="actor"
            defaultValue={filters.actor}
            className="field h-10 w-72 border-input px-3"
          />
        </label>
        <Button type="submit" variant="outline">
          {t('filters.apply')}
        </Button>
        {Object.keys(filters).length ? (
          <Link href="/admin/audit" className="pb-2 text-sm text-primary hover:underline">
            {t('filters.clear')}
          </Link>
        ) : null}
      </form>

      {page.items.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground" data-testid="audit-empty">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-3xl border bg-card">
          <table className="w-full text-left text-sm" data-testid="audit-table">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">{t('columns.at')}</th>
                <th className="px-4 py-3 font-semibold">{t('columns.action')}</th>
                <th className="px-4 py-3 font-semibold">{t('columns.target')}</th>
                <th className="px-4 py-3 font-semibold">{t('columns.actor')}</th>
                <th className="px-4 py-3 font-semibold">{t('columns.reason')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map((e) => (
                <tr key={e.id} data-testid="audit-entry">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    {format.dateTime(new Date(e.at), { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td className="px-4 py-3 font-medium">{t(actionKey(e.action) as never)}</td>
                  <td className="px-4 py-3">
                    <span className="text-muted-foreground">
                      {t(`targets.${e.target.type}` as never)}{' '}
                    </span>
                    {e.target.type === 'listing' ? (
                      <a
                        href={`${env.publicBaseUrl}/${locale}/listings/${e.target.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-primary hover:underline"
                        title={e.target.id}
                      >
                        {short(e.target.id)}
                      </a>
                    ) : (
                      <span className="font-mono" title={e.target.id}>
                        {short(e.target.id)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/audit?actor=${e.actor.id}`}
                      className="font-mono hover:underline"
                      title={e.actor.id}
                    >
                      {short(e.actor.id)}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {e.actor.roles.join(', ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{e.reason ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.hasMore && last ? (
        <Link href={`/admin/audit?${older}`} className="font-semibold text-primary hover:underline">
          {t('older')} →
        </Link>
      ) : null}
    </div>
  );
}
