import { countryOfCategory, facetsOf, subcategoriesOf } from '@raadi/catalog/categories';
import { Button, EmptyState } from '@raadi/ui';
import { ChevronRight, Plus, Search, ShoppingBag } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingGrid } from '@/components/listings/listing-card';
import { SearchBox } from '@/components/search/search-box';
import { Link } from '@/i18n/navigation';
import { searchListings } from '@/lib/api';
import { makeLabel } from '@/lib/format';
import { currentCountry, currentLocales } from '@/lib/host';
import { logger } from '@/lib/logger';
import { href } from '@/lib/search-params';
import { localeAlternates } from '@/lib/seo';
import { CATEGORY_ICONS, SHORTCUTS, SUBCATEGORY_ICONS } from '@/lib/taxonomy-icons';
import { ClientMessages } from '@/components/client-messages';

export const dynamic = 'force-dynamic';

/** A category of the country this host serves (ADR-0040); others are not found here. */
const isCategory = async (value: string) => countryOfCategory(value) === (await currentCountry());

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}): Promise<Metadata> {
  const { locale, category } = await params;
  if (!(await isCategory(category))) return {};
  const t = await getTranslations('home');
  return {
    title: t(`categories.${category}.name`),
    description: t(`categories.${category}.description`),
    alternates: localeAlternates(await currentLocales(), locale, `/${category}`),
  };
}

/** A category's front page, like FINN's: subcategory tiles with counts, shortcuts, newest listings. */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}) {
  const { locale, category } = await params;
  if (!(await isCategory(category))) notFound();
  setRequestLocale(locale);
  const [t, tHome, format] = await Promise.all([
    getTranslations(),
    getTranslations('home'),
    getFormatter(),
  ]);
  // The page still renders if search is down: tiles without counts, no listings.
  // Recently reduced (ADR-0044, ADR-0046): a row of its own when there are any.
  const reducedPromise = searchListings({
    category,
    priceDropped: 'true',
    sort: 'price_drop',
    pageSize: 4,
  }).catch(() => null);
  const result = await searchListings({ category, sort: 'newest', pageSize: 8 }).catch(
    (error: unknown) => {
      logger.warn({ err: error }, 'category listings unavailable');
      return null;
    },
  );
  const reduced = await reducedPromise;
  const counts = new Map(result?.facets.subcategory?.map((f) => [f.value, f.count]));
  const shortcuts = SHORTCUTS[category] ?? [];
  const hasMakes = facetsOf(category).some((f) => f.key === 'make');
  const makes = hasMakes ? (result?.facets.make ?? []).slice(0, 12) : [];
  const Icon = CATEGORY_ICONS[category] ?? ShoppingBag;
  const name = tHome(`categories.${category}.name`);

  return (
    <ClientMessages set="category">
      <div className="space-y-14" data-testid="category-page">
        <section className="space-y-6 pt-2 sm:pt-6">
          <nav aria-label={t('nav.breadcrumb')} className="text-sm text-muted-foreground">
            <ol className="flex items-center gap-1">
              <li>
                <Link href="/" className="hover:underline">
                  Raadiso
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight className="size-3.5" />
              </li>
              <li aria-current="page" className="text-foreground">
                {name}
              </li>
            </ol>
          </nav>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="flex size-16 items-center justify-center rounded-card bg-inverse text-inverse-foreground">
              <Icon aria-hidden strokeWidth={1.6} className="size-8" />
            </span>
            <div className="space-y-1">
              <h1 className="text-display font-extrabold">{name}</h1>
              <p className="text-lg text-subtle-foreground">
                {tHome(`categories.${category}.description`)}
              </p>
            </div>
          </div>
          <form
            action={`/${locale}/search`}
            method="get"
            role="search"
            className="flex max-w-3xl items-center gap-2 rounded-sheet border bg-card p-1.5 shadow-2"
          >
            <input type="hidden" name="category" value={category} />
            <Search aria-hidden className="ms-3 size-5 shrink-0 text-subtle-foreground" />
            <SearchBox
              country={await currentCountry()}
              placeholder={t('categoryPage.searchIn', { category: name })}
              label={t('categoryPage.searchIn', { category: name })}
              testId="category-search-input"
              className="min-w-0 flex-1"
              inputClassName="h-12 w-full bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              className="focus-ring h-12 rounded-full bg-primary px-6 font-semibold text-primary-foreground motion-safe:transition-colors hover:bg-primary/90"
            >
              {t('search.submit')}
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {result?.total ? (
              <Link
                href={href({ category })}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                data-testid="category-see-all"
              >
                {t('categoryPage.seeAll', { total: format.number(result.total) })}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : null}
            <Link
              href={`/listings/new?category=${category}`}
              prefetch={false}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold motion-safe:transition-colors hover:bg-accent focus-ring"
              data-testid="category-new-listing"
            >
              <Plus aria-hidden className="size-4" />
              {t('categoryPage.newListing', { category: name })}
            </Link>
          </div>
        </section>

        <section aria-labelledby="subcategories" className="space-y-5">
          <h2 id="subcategories" className="text-xl font-bold">
            {t('categoryPage.subcategoriesTitle')}
          </h2>
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
            role="list"
            data-testid="subcategory-tiles"
          >
            {subcategoriesOf(category).map((sub) => {
              const SubIcon = SUBCATEGORY_ICONS[sub] ?? ShoppingBag;
              const count = counts.get(sub);
              return (
                <li key={sub} className="flex">
                  <Link
                    href={href({ category, subcategory: sub })}
                    data-testid={`subcategory-${sub}`}
                    className="group flex flex-1 flex-col gap-4 rounded-card border bg-card p-5 motion-safe:transition-[transform,background-color] motion-safe:hover:-translate-y-0.5 hover:bg-accent focus-ring"
                  >
                    <span className="flex size-11 items-center justify-center rounded-card bg-soft text-soft-foreground motion-safe:transition-colors group-hover:bg-highlight group-hover:text-highlight-foreground">
                      <SubIcon aria-hidden strokeWidth={1.7} className="size-[22px]" />
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold leading-tight">
                        {t(`taxonomy.subcategories.${sub}` as never)}
                      </span>
                      {count !== undefined ? (
                        <span className="text-sm text-muted-foreground">
                          {t('categoryPage.listings', { count })}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {shortcuts.length || makes.length ? (
          <section aria-labelledby="shortcuts" className="space-y-4">
            <h2 id="shortcuts" className="text-xl font-bold">
              {t('categoryPage.shortcutsTitle')}
            </h2>
            <ul className="flex flex-wrap gap-2" role="list" data-testid="category-shortcuts">
              {shortcuts.map((s) => (
                <li key={s.key}>
                  <Link
                    href={href({ category, ...s.params })}
                    className="inline-flex h-10 items-center rounded-full border bg-card px-4 text-sm font-medium motion-safe:transition-colors hover:bg-accent focus-ring"
                  >
                    {t(`categoryPage.shortcuts.${category}.${s.key}` as never)}
                  </Link>
                </li>
              ))}
            </ul>
            {makes.length ? (
              <div className="space-y-3 pt-2">
                <h3 className="text-sm font-semibold text-subtle-foreground">
                  {t('categoryPage.makesTitle')}
                </h3>
                <ul className="flex flex-wrap gap-2" role="list" data-testid="category-makes">
                  {makes.map((m) => (
                    <li key={m.value}>
                      <Link
                        href={href({ category, make: m.value })}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-soft px-3.5 text-sm font-medium text-soft-foreground motion-safe:transition-colors hover:bg-accent"
                      >
                        {makeLabel(m.value)}
                        <span className="text-xs opacity-70">{m.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {reduced?.items.length ? (
          <section aria-labelledby="reduced" className="space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="reduced" className="text-xl font-bold">
                {t('categoryPage.reducedTitle')}
              </h2>
              <Link
                href={href({ category, priceDropped: 'true', sort: 'price_drop' })}
                className="rounded font-semibold text-primary hover:underline"
              >
                {tHome('seeAll')} →
              </Link>
            </div>
            <ListingGrid items={reduced.items} testId="category-reduced" />
          </section>
        ) : null}

        {result && result.total === 0 ? (
          // An empty category invites the first listing instead of "See all 0 listings".
          <EmptyState
            icon={<Icon aria-hidden strokeWidth={1.6} />}
            title={t('categoryPage.emptyTitle', { category: name })}
            action={
              <Button asChild>
                <Link
                  href={`/listings/new?category=${category}`}
                  prefetch={false}
                  data-testid="category-empty-post"
                >
                  <Plus aria-hidden />
                  {t('categoryPage.emptyAction')}
                </Link>
              </Button>
            }
            className="rounded-card border bg-card"
            data-testid="category-empty"
          >
            {t('categoryPage.emptyBody')}
          </EmptyState>
        ) : null}

        {result?.items.length ? (
          <section aria-labelledby="newest" className="space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="newest" className="text-xl font-bold">
                {t('categoryPage.latestTitle', { category: name })}
              </h2>
              <Link
                href={href({ category, sort: 'newest' })}
                className="rounded font-semibold text-primary hover:underline"
              >
                {tHome('seeAll')} →
              </Link>
            </div>
            <ListingGrid items={result.items} testId="category-latest" />
          </section>
        ) : null}
      </div>
    </ClientMessages>
  );
}
