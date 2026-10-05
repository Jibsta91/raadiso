import { Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ago } from '@/components/admin/time';
import {
  Bars,
  Empty,
  Field,
  FilterBar,
  Id,
  inputCls,
  PageHeader,
  Pager,
  Panel,
  Pill,
  Stat,
  Table,
  td,
  Unavailable,
} from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import { type OrderQuery, paymentStats, searchOrders, settle } from '@/lib/admin/api';
import { nok } from '@/lib/admin/format';
import { orderTone } from '@/lib/admin/tones';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('orders') };
}

const PAGE = 25;
const STATUSES = [
  'created',
  'authorized',
  'captured',
  'refunded',
  'cancelled',
  'expired',
  'failed',
] as const;
type OrderStatus = (typeof STATUSES)[number];

/** Orders and revenue (support reads, platform admins refund). */
export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('orders', session.user.roles)) notFound();
  const t = await getTranslations('admin.orders');
  const query: OrderQuery = {
    q: sp.q?.trim() || undefined,
    user: /^[0-9a-f-]{36}$/i.test(sp.user ?? '') ? sp.user : undefined,
    status: STATUSES.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : undefined,
    limit: PAGE,
    offset: Math.max(0, Number(sp.offset) || 0),
  };
  const [page, stats] = await Promise.all([settle(searchOrders(query)), settle(paymentStats())]);
  const href = (offset: number) =>
    `/admin/orders?${new URLSearchParams(
      Object.entries({ ...query, offset: String(offset), limit: undefined })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    )}`;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} />
      {stats ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_2fr]">
          <Stat
            label={t('stats.revenue')}
            value={nok(stats.capturedOre30d, locale)}
            hint={t('stats.last30')}
            tone="good"
          />
          <Stat
            label={t('stats.refunded')}
            value={nok(stats.refundedOre30d, locale)}
            hint={t('stats.stuck', { count: stats.stuck })}
            tone={stats.stuck ? 'bad' : undefined}
          />
          <Panel title={t('stats.daily')} bodyClassName="p-3">
            <Bars
              values={stats.revenue.map((d) => d.ore)}
              labels={stats.revenue.map((d) => d.day)}
              format={(n) => nok(n, locale)}
              className="h-16"
            />
          </Panel>
        </div>
      ) : null}
      {stats ? (
        <p className="flex flex-wrap gap-1.5">
          {stats.byStatus.map((s) => (
            <Link key={s.status} href={`/admin/orders?status=${s.status}`} prefetch={false}>
              <Pill tone={orderTone(s.status)}>
                {t(`status.${s.status}` as never)} · {s.count}
              </Pill>
            </Link>
          ))}
        </p>
      ) : null}
      <FilterBar testId="order-filters">
        <Field label={t('filters.q')}>
          <input
            name="q"
            defaultValue={query.q}
            placeholder={t('filters.qPlaceholder')}
            className={`${inputCls} w-64 font-mono`}
          />
        </Field>
        <Field label={t('filters.status')}>
          <select name="status" defaultValue={query.status ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        {query.user ? <input type="hidden" name="user" value={query.user} /> : null}
        <button
          type="submit"
          className="h-9 rounded-full bg-ink px-4 text-sm font-semibold text-ink-foreground"
        >
          {t('filters.apply')}
        </button>
      </FilterBar>
      {!page ? (
        <Unavailable>{t('unavailable')}</Unavailable>
      ) : page.items.length === 0 ? (
        <Empty icon={Receipt}>{t('empty')}</Empty>
      ) : (
        <>
          <Table
            testId="orders-table"
            head={[
              t('columns.order'),
              t('columns.product'),
              t('columns.amount'),
              t('columns.status'),
              t('columns.provider'),
              t('columns.user'),
              t('columns.created'),
            ]}
          >
            {page.items.map((o) => (
              <tr key={o.id} className="hover:bg-accent/50" data-testid="order-row">
                <td className={td}>
                  <Id value={o.id} href={`/admin/orders/${o.id}`} />
                </td>
                <td className={td}>{t(`products.${o.product}` as never)}</td>
                <td className={`${td} tabular-nums font-medium`}>{nok(o.amountOre, locale)}</td>
                <td className={td}>
                  <Pill tone={orderTone(o.status)} dot>
                    {t(`status.${o.status}`)}
                  </Pill>
                </td>
                <td className={`${td} text-muted-foreground`}>{o.provider}</td>
                <td className={td}>
                  {canOpen('users', session.user.roles) ? (
                    <Id value={o.userId} href={`/admin/users/${o.userId}`} />
                  ) : (
                    <Id value={o.userId} />
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                  <Ago at={o.createdAt} />
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            total={page.total}
            offset={query.offset ?? 0}
            limit={PAGE}
            href={href}
            labels={{
              prev: t('prev'),
              next: t('next'),
              range: t('range', {
                from: (query.offset ?? 0) + 1,
                to: (query.offset ?? 0) + page.items.length,
                total: page.total,
              }),
            }}
          />
        </>
      )}
    </div>
  );
}
