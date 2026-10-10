import type { PriceInsight as Insight } from '@raadi/api-client';
import { formatMoney } from '@raadi/catalog/money';
import { AlertTriangle, TrendingDown } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

const TONE: Record<Insight['rating'], string> = {
  unusually_low: 'bg-destructive/10 text-destructive',
  great: 'bg-highlight text-highlight-foreground',
  good: 'bg-soft text-soft-foreground',
  fair: 'bg-muted text-foreground',
  high: 'bg-muted text-foreground',
};

/**
 * How the price compares with comparable listings (ADR-0043): a rating, the comparables' middle half
 * and median on a bar with this listing's price marked, and what was compared. An unusually low price
 * is a warning with the safety tips, never a bargain.
 */
export async function PriceInsight({ insight }: { insight: Insight }) {
  const [t, tax, locale] = await Promise.all([
    getTranslations('price'),
    getTranslations('taxonomy'),
    getLocale(),
  ]);
  const { stats, currency, rating } = insight;
  const money = (amountMinor: number) =>
    formatMoney({ amountMinor: Math.round(amountMinor), currency }, locale);
  const per = stats.unit === 'listing' ? '' : ` ${t(`per.${stats.unit}`)}`;
  // The bar spans from half the 25th percentile to 1.5 × the 75th; the marker is clamped onto it.
  const lo = stats.p25 / 2;
  const hi = stats.p75 * 1.5;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  const compared = [
    ...stats.basis.same.map((k) => tax(`attributes.${k}` as never)),
    ...stats.basis.near.map((k) => tax(`attributes.${k}` as never)),
    ...(stats.basis.region ? [t('region')] : []),
  ];

  return (
    <section
      aria-labelledby="price-insight"
      className="space-y-3 rounded-card border p-4"
      data-testid="price-insight"
      data-rating={rating}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="price-insight" className="text-sm font-semibold">
          {t('title')}
        </h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold ${TONE[rating]}`}
        >
          {rating === 'unusually_low' ? (
            <AlertTriangle aria-hidden className="size-3.5" />
          ) : rating === 'great' || rating === 'good' ? (
            <TrendingDown aria-hidden className="size-3.5" />
          ) : null}
          {t(`rating.${rating}`)}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted" aria-hidden>
        <div
          className="absolute inset-y-0 rounded-full bg-soft"
          style={{
            insetInlineStart: at(stats.p25),
            insetInlineEnd: `calc(100% - ${at(stats.p75)})`,
          }}
        />
        <div
          className="absolute -top-1 h-4 w-0.5 bg-foreground/40"
          style={{ insetInlineStart: at(stats.median) }}
        />
        <div
          className="absolute -top-1.5 size-5 -translate-x-1/2 rounded-full border-2 border-background bg-primary rtl:translate-x-1/2"
          style={{ insetInlineStart: at(insight.unitPrice) }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('range', {
          count: stats.comparables,
          from: money(stats.p25) + per,
          to: money(stats.p75) + per,
          median: money(stats.median) + per,
        })}
        {compared.length ? ` ${t('compared', { what: compared.join(', ') })}` : ''}
      </p>
      {rating === 'unusually_low' ? (
        <p className="text-sm" data-testid="price-warning">
          {t('warning')}{' '}
          <Link
            href="/terms"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('safety')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
