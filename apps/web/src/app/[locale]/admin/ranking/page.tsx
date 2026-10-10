import { Alert, Input, Select } from '@raadi/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader, Panel, Pill } from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import { AdminApiError, rankingLab } from '@/lib/admin/api';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('ranking') };
}

const weight = (v: string | undefined) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 3 ? n : undefined;
};

/**
 * The ranking lab (ADR-0042): best match for a query, each listing's score taken apart into text
 * relevance, quality and freshness, with weights to preview. Nothing is saved: defaults change by pull
 * request, checked by the judged queries.
 */
export default async function RankingLabPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('ranking', session.user.roles)) notFound();
  const [t, tax, format, query] = await Promise.all([
    getTranslations('admin.ranking'),
    getTranslations('taxonomy'),
    getFormatter(),
    searchParams,
  ]);
  const country = query.country === 'NO' ? 'NO' : 'XS';
  const lab = await rankingLab({
    q: query.q || undefined,
    country,
    category: query.category || undefined,
    quality: weight(query.quality),
    freshness: weight(query.freshness),
  }).catch((error: unknown) => {
    if (error instanceof AdminApiError) return null;
    throw error;
  });
  const input = 'h-10 w-auto';
  const num = (n: number, digits = 2) =>
    format.number(n, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const age = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} />
      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="ranking-form">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">{t('query')}</span>
          <Input name="q" defaultValue={query.q ?? ''} className={input} placeholder="toyota" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('country')}</span>
          <Select name="country" defaultValue={country} className={input}>
            <option value="XS">Somaliland (XS)</option>
            <option value="NO">Norway (NO)</option>
          </Select>
        </label>
        {(['quality', 'freshness'] as const).map((w) => (
          <label key={w} className="flex w-32 flex-col gap-1 text-sm">
            <span className="font-medium">{t(`weights.${w}`)}</span>
            <Input
              name={w}
              type="number"
              min={0}
              max={3}
              step={0.1}
              defaultValue={query[w] ?? lab?.defaults[w] ?? ''}
              className={input}
              data-testid={`weight-${w}`}
            />
          </label>
        ))}
        <button
          type="submit"
          className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          {t('run')}
        </button>
      </form>

      {!lab ? (
        <Alert variant="danger" className="w-full p-3">
          {t('unavailable')}
        </Alert>
      ) : (
        <Panel
          title={t('results', { total: lab.total })}
          actions={
            <span className="text-sm text-muted-foreground">
              {t('defaults', {
                quality: lab.defaults.quality,
                freshness: lab.defaults.freshness,
              })}
            </span>
          }
          testId="ranking-results"
        >
          {lab.query.understood.length ? (
            <p className="mb-3 text-sm text-muted-foreground">
              {t('understood', { text: lab.query.text || '–' })}{' '}
              {lab.query.understood.map((u) => (
                <Pill key={u.words} className="me-1">
                  {u.words} → {Object.values(u.set).join(' / ')}
                </Pill>
              ))}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('caption')}</caption>
              <thead className="text-start text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {[
                    '#',
                    t('cols.listing'),
                    t('cols.photos'),
                    t('cols.age'),
                    t('cols.relevance'),
                    t('cols.quality'),
                    t('cols.freshness'),
                    t('cols.multiplier'),
                    t('cols.score'),
                  ].map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 text-start font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lab.items.map((x, i) => (
                  <tr key={x.id} className="border-t" data-testid="ranking-row">
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/admin/listings/${x.id}`}
                        className="font-medium hover:underline"
                      >
                        {x.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {tax(`subcategories.${x.subcategory}` as never)}
                        {x.promoted ? (
                          <Pill tone="good" className="ms-2">
                            {t('promoted')}
                          </Pill>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{x.imageCount}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {t('days', { days: age(x.publishedAt) })}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{num(x.relevance)}</td>
                    <td className="px-2 py-2 tabular-nums">{num(x.quality)}</td>
                    <td className="px-2 py-2 tabular-nums">{num(x.freshness)}</td>
                    <td className="px-2 py-2 tabular-nums">× {num(x.multiplier)}</td>
                    <td className="px-2 py-2 font-semibold tabular-nums">{num(x.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
