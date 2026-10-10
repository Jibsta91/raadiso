import { cn } from '@raadi/ui';
import { categoriesOf } from '@raadi/catalog/categories';
import { Lock, Search, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthErrorBanner } from '@/components/auth-error-banner';
import { ListingGrid } from '@/components/listings/listing-card';
import { RecentlyViewed } from '@/components/listings/recently-viewed';
import { SearchBox } from '@/components/search/search-box';
import { Link } from '@/i18n/navigation';
import { searchListings } from '@/lib/api';
import { currentCountry, currentLocales } from '@/lib/host';
import { logger } from '@/lib/logger';
import { localeAlternates } from '@/lib/seo';
import { CATEGORY_ICONS } from '@/lib/taxonomy-icons';
import { ClientMessages } from '@/components/client-messages';

// A bento grid: the first category is the tall ink tile; then plain, soft (two columns), plain and
// highlight (two columns) tiles repeat. Norway's five categories keep the layout they always had.
const TILES = [
  { tile: 'border bg-card', icon: '', body: '' },
  { tile: 'col-span-2 bg-soft text-soft-foreground', icon: '', body: 'opacity-80' },
  { tile: 'border bg-card', icon: '', body: '' },
  { tile: 'col-span-2 bg-highlight text-highlight-foreground', icon: '', body: 'opacity-80' },
] as const;
const FIRST_TILE = {
  // Inverse stays dark (and lifted) in dark mode, so the lime icon works in both themes.
  tile: 'col-span-2 bg-inverse text-inverse-foreground lg:col-span-1 lg:row-span-2',
  icon: 'text-highlight',
  body: 'opacity-80',
};

const TRUST = [
  { key: 'verified', Icon: ShieldCheck },
  { key: 'ai', Icon: Sparkles },
  { key: 'privacy', Icon: Lock },
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: localeAlternates(await currentLocales(), locale, '') };
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ authError?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { authError } = await searchParams;
  const t = await getTranslations('home');
  const country = await currentCountry();
  const categories = categoriesOf(country).map(({ id }, i) => ({
    key: id,
    Icon: CATEGORY_ICONS[id] ?? ShoppingBag,
    large: i === 0,
    ...(i === 0 ? FIRST_TILE : TILES[(i - 1) % TILES.length]!),
  }));
  // The front page still renders if search is down; it just omits the latest listings.
  const latest = await searchListings({ sort: 'newest', pageSize: 8 }).catch((error: unknown) => {
    logger.warn({ err: error }, 'latest listings unavailable');
    return null;
  });

  return (
    <ClientMessages set="home">
      <div className="space-y-20">
        {authError ? <AuthErrorBanner code={authError} /> : null}

        <section className="flex flex-col gap-7 pt-6 sm:pt-14">
          <h1 className="max-w-4xl text-display font-extrabold">
            {/* Each language marks the brand, wherever it falls: it gets its own line and the accent. */}
            {t.rich('heroTitle', {
              brand: (chunks) => <span className="block text-primary">{chunks}</span>,
            })}
          </h1>
          <p className="max-w-xl text-lg text-subtle-foreground">{t('heroSubtitle')}</p>
          <form
            action={`/${locale}/search`}
            method="get"
            role="search"
            className="flex max-w-3xl flex-wrap items-center gap-2 rounded-sheet border bg-card p-2 shadow-2"
          >
            <Search aria-hidden className="ms-3 size-[22px] shrink-0 text-subtle-foreground" />
            <SearchBox
              country={country}
              placeholder={t('searchPlaceholder')}
              label={t('searchPlaceholder')}
              testId="home-search-input"
              className="min-w-0 flex-[1_1_14rem]"
              inputClassName="h-12 w-full bg-transparent text-lg placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              className="focus-ring h-12 flex-[1_0_auto] rounded-full bg-primary px-7 text-base font-semibold text-primary-foreground motion-safe:transition-colors hover:bg-primary/90 sm:flex-none"
            >
              {t('searchSubmit')}
            </button>
          </form>
        </section>

        <section aria-labelledby="categories" className="space-y-5">
          <h2 id="categories" className="text-2xl font-bold">
            {t('categoriesTitle')}
          </h2>
          <div className="grid grid-flow-dense auto-rows-[10rem] grid-cols-2 gap-4 lg:auto-rows-[10.5rem] lg:grid-cols-4">
            {categories.map(({ key, Icon, tile, icon, body, large }) => (
              <Link
                key={key}
                href={`/${key}`}
                data-testid={`category-${key}`}
                className={cn(
                  'focus-ring flex flex-col justify-between rounded-card p-6 motion-safe:transition-[transform,box-shadow] hover:shadow-2 motion-safe:hover:-translate-y-0.5',
                  tile,
                )}
              >
                <Icon
                  aria-hidden
                  strokeWidth={1.6}
                  className={cn('shrink-0', large ? 'size-9' : 'size-7', icon)}
                />
                <span className="flex flex-col gap-1">
                  <span
                    className={cn(
                      'font-display font-bold leading-none tracking-[-0.03em]',
                      large ? 'text-2xl' : 'text-xl',
                    )}
                  >
                    {t(`categories.${key}.name`)}
                  </span>
                  {body ? (
                    <span className={cn('text-sm sm:text-base', body)}>
                      {t(`categories.${key}.description`)}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <RecentlyViewed />

        {latest?.items.length ? (
          <section aria-labelledby="latest" className="space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="latest" className="text-2xl font-bold">
                {t('latestTitle')}
              </h2>
              <Link
                href="/search?sort=newest"
                className="rounded font-semibold text-primary hover:underline"
              >
                {t('seeAll')} →
              </Link>
            </div>
            <ListingGrid items={latest.items} testId="latest-listings" />
          </section>
        ) : null}

        <section aria-labelledby="trust" className="grid gap-4 md:grid-cols-3">
          <h2 id="trust" className="sr-only">
            {t('trustTitle')}
          </h2>
          {TRUST.map(({ key, Icon }) => (
            <div key={key} className="flex flex-col gap-2 rounded-card border bg-card p-6">
              <Icon aria-hidden strokeWidth={1.8} className="size-7 text-primary" />
              <h3 className="text-lg font-semibold">{t(`trust.${key}.title`)}</h3>
              <p className="text-muted-foreground">{t(`trust.${key}.body`)}</p>
            </div>
          ))}
        </section>
      </div>
    </ClientMessages>
  );
}
