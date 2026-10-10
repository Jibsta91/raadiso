import { Input, Select } from '@raadi/ui';
import { CATEGORY_KEYS } from '@raadi/catalog';
import { Flag, Package } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ago } from '@/components/admin/time';
import {
  Bars,
  Empty,
  Field,
  FilterBar,
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
import { type ListingQuery, listingStats, searchAdminListings, settle } from '@/lib/admin/api';
import { count } from '@/lib/admin/format';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('listings') };
}

const PAGE = 25;
const STATUSES = ['active', 'sold', 'deleted'] as const;

/** Every listing in any state, with open reports (moderators, support, platform admins). */
export default async function ListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('listings', session.user.roles)) notFound();
  const [t, tx] = await Promise.all([
    getTranslations('admin.listings'),
    getTranslations('taxonomy'),
  ]);
  const query: ListingQuery = {
    q: sp.q?.trim() || undefined,
    owner: /^[0-9a-f-]{36}$/i.test(sp.owner ?? '') ? sp.owner : undefined,
    status: STATUSES.includes(sp.status as never)
      ? (sp.status as ListingQuery['status'])
      : undefined,
    category: CATEGORY_KEYS.includes(sp.category as never) ? sp.category : undefined,
    reported: sp.reported === 'true' ? 'true' : undefined,
    limit: PAGE,
    offset: Math.max(0, Number(sp.offset) || 0),
  };
  const [page, stats] = await Promise.all([
    settle(searchAdminListings(query)),
    settle(listingStats()),
  ]);
  const href = (offset: number) =>
    `/admin/listings?${new URLSearchParams(
      Object.entries({ ...query, offset: String(offset), limit: undefined })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    )}`;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} />
      {stats ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.4fr]">
          <Stat label={t('stats.active')} value={count(stats.active, locale)} tone="good" />
          <Stat label={t('stats.sold')} value={count(stats.sold, locale)} />
          <Stat
            label={t('stats.reported')}
            value={count(stats.moderation.listings, locale)}
            href="/admin/listings?reported=true"
            tone="bad"
            icon={Flag}
          />
          <Panel title={t('stats.created')} bodyClassName="p-3">
            <Bars
              values={stats.created.map((d) => d.count)}
              labels={stats.created.map((d) => d.day)}
              className="h-14"
            />
          </Panel>
        </div>
      ) : null}
      <FilterBar testId="listing-filters">
        <Field label={t('filters.q')}>
          <Input
            name="q"
            defaultValue={query.q}
            placeholder={t('filters.qPlaceholder')}
            className={`${inputCls} w-72`}
          />
        </Field>
        <Field label={t('filters.status')}>
          <Select name="status" defaultValue={query.status ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.category')}>
          <Select name="category" defaultValue={query.category ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            {CATEGORY_KEYS.map((c) => (
              <option key={c} value={c}>
                {tx(`categories.${c}` as never)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="reported"
            value="true"
            defaultChecked={query.reported === 'true'}
            className="size-4"
          />
          {t('filters.reported')}
        </label>
        {query.owner ? <input type="hidden" name="owner" value={query.owner} /> : null}
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
        <Empty icon={Package}>{t('empty')}</Empty>
      ) : (
        <>
          <Table
            testId="listings-table"
            head={[
              t('columns.listing'),
              t('columns.seller'),
              t('columns.category'),
              t('columns.status'),
              t('columns.reports'),
              t('columns.created'),
            ]}
          >
            {page.items.map((l) => (
              <tr key={l.id} className="hover:bg-accent/50" data-testid="listing-row">
                <td className={td}>
                  <Link
                    href={`/admin/listings/${l.id}`}
                    prefetch={false}
                    className="flex items-center gap-3"
                  >
                    {l.image ? (
                      <img
                        src={l.image.thumb}
                        alt=""
                        className="size-10 shrink-0 rounded-card object-cover"
                      />
                    ) : (
                      <span className="size-10 shrink-0 rounded-card bg-placeholder" />
                    )}
                    <span className="line-clamp-2 font-medium hover:underline">{l.title}</span>
                  </Link>
                </td>
                <td className={td}>
                  <Link
                    href={`/admin/listings?owner=${l.ownerId}`}
                    prefetch={false}
                    className="hover:underline"
                  >
                    {l.sellerName}
                  </Link>
                </td>
                <td className={`${td} text-muted-foreground`}>
                  {tx(`categories.${l.category}` as never)}
                </td>
                <td className={td}>
                  <Pill
                    tone={
                      l.status === 'active' ? 'good' : l.status === 'deleted' ? 'bad' : 'neutral'
                    }
                  >
                    {l.status === 'deleted' && l.removedBy === 'moderation'
                      ? t('removedByModeration')
                      : t(`status.${l.status}`)}
                  </Pill>
                </td>
                <td className={td}>
                  {l.openReports ? (
                    <Pill tone="bad">{l.openReports}</Pill>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                  <Ago at={l.createdAt} />
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
