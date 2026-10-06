import { CATEGORIES, CATEGORY_KEYS, type Category } from '@raadi/catalog';
import { ChevronRight, Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingCard } from '@/components/listings/listing-card';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { searchListings } from '@/lib/api';
import { makeLabel } from '@/lib/format';
import { logger } from '@/lib/logger';
import { href } from '@/lib/search-params';
import { localeAlternates } from '@/lib/seo';
import { CATEGORY_ICONS, SHORTCUTS, SUBCATEGORY_ICONS } from '@/lib/taxonomy-icons';

export const dynamic = 'force-dynamic';

const isCategory = (value: string): value is Category =>
  (CATEGORY_KEYS as readonly string[]).includes(value);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}): Promise<Metadata> {
  const { locale, category } = await params;
  if (!isCategory(category)) return {};
  const t = await getTranslations('home');
  return {
    title: t(`categories.${category}.name`),
    description: t(`categories.${category}.description`),
    alternates: localeAlternates(routing, locale, `/${category}`),
  };
}

/** A category's front page, like FINN's: subcategory tiles with counts, shortcuts, newest listings. */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}) {
  const { locale, category } = await params;
  if (!isCategory(category)) notFound();
  setRequestLocale(locale);
  const [t, tHome, format] = await Promise.all([
    getTranslations(),
    getTranslations('home'),
    getFormatter(),
  ]);
  // The page still renders if search is down: tiles without counts, no listings.
  const result = await searchListings({ category, sort: 'newest', pageSize: 8 }).catch(
    (error: unknown) => {
      logger.warn({ err: error }, 'category listings unavailable');
      return null;
    },
  );
  const counts = new Map(result?.facets.subcategory.map((f) => [f.value, f.count]));
  const makes = category === 'bil' ? (result?.facets.make ?? []).slice(0, 12) : [];
  const Icon = CATEGORY_ICONS[category];
  const name = tHome(`categories.${category}.name`);

  return (
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
          <span className="flex size-16 items-center justify-center rounded-[1.4rem] bg-ink text-ink-foreground">
            <Icon aria-hidden strokeWidth={1.6} className="size-8" />
          </span>
          <div className="space-y-1">
            <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-[-0.045em]">
              {name}
            </h1>
            <p className="text-lg text-subtle-foreground">
              {tHome(`categories.${category}.description`)}
            </p>
          </div>
        </div>
        <form
          action={`/${locale}/search`}
          method="get"
          role="search"
          className="flex max-w-3xl items-center gap-2 rounded-[24px] border bg-card/85 p-1.5 shadow-float backdrop-blur-xl"
        >
          <input type="hidden" name="category" value={category} />
          <label htmlFor="category-q" className="sr-only">
            {t('categoryPage.searchIn', { category: name })}
          </label>
          <Search aria-hidden className="ms-3 size-5 shrink-0 text-subtle-foreground" />
          <input
            id="category-q"
            name="q"
            type="search"
            placeholder={t('categoryPage.searchIn', { category: name })}
            data-testid="category-search-input"
            className="h-12 min-w-0 flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            className="h-12 rounded-[18px] bg-primary px-6 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('search.submit')}
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {result ? (
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
            className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="category-new-listing"
          >
            <Plus aria-hidden className="size-4" />
            {t('categoryPage.newListing', { category: name })}
          </Link>
        </div>
      </section>

      <section aria-labelledby="subcategories" className="space-y-5">
        <h2 id="subcategories" className="text-2xl font-bold">
          {t('categoryPage.subcategoriesTitle')}
        </h2>
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
          role="list"
          data-testid="subcategory-tiles"
        >
          {CATEGORIES[category].map((sub) => {
            const SubIcon = SUBCATEGORY_ICONS[sub];
            const count = counts.get(sub);
            return (
              <li key={sub} className="flex">
                <Link
                  href={href({ category, subcategory: sub })}
                  data-testid={`subcategory-${sub}`}
                  className="group flex flex-1 flex-col gap-4 rounded-[1.6rem] border bg-card p-5 transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-soft text-soft-foreground transition-colors group-hover:bg-highlight group-hover:text-highlight-foreground">
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

      <section aria-labelledby="shortcuts" className="space-y-4">
        <h2 id="shortcuts" className="text-2xl font-bold">
          {t('categoryPage.shortcutsTitle')}
        </h2>
        <ul className="flex flex-wrap gap-2" role="list" data-testid="category-shortcuts">
          {SHORTCUTS[category].map((s) => (
            <li key={s.key}>
              <Link
                href={href({ category, ...s.params })}
                className="inline-flex h-10 items-center rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-soft px-3.5 text-sm font-medium text-soft-foreground transition-colors hover:bg-accent"
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

      {result?.items.length ? (
        <section aria-labelledby="newest" className="space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="newest" className="text-2xl font-bold">
              {t('categoryPage.latestTitle', { category: name })}
            </h2>
            <Link
              href={href({ category, sort: 'newest' })}
              className="rounded font-semibold text-primary hover:underline"
            >
              {tHome('seeAll')} →
            </Link>
          </div>
          <ul
            className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 lg:grid-cols-4"
            role="list"
            data-testid="category-latest"
          >
            {result.items.map((hit) => (
              <li key={hit.id} className="flex">
                <ListingCard hit={hit} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
