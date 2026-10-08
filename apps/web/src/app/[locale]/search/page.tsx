import {
  categoriesOf,
  countryOfCategory,
  facetsOf,
  rangesOf,
  BASE_SORTS,
  sortsOf,
} from '@raadi/catalog/categories';
import { currencySymbol } from '@raadi/catalog/money';
import { findPlace, regionName } from '@raadi/catalog/places';
import type { SearchQuery } from '@raadi/api-client';
import { Button } from '@raadi/ui';
import { ChevronRight, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingCard } from '@/components/listings/listing-card';
import { ActiveFilters, facetChips, paramChip } from '@/components/search/active-filters';
import { FacetGroup } from '@/components/search/facet-group';
import { FilterPanel } from '@/components/search/filter-panel';
import { SaveSearchButton } from '@/components/saved/saved-search-controls';
import { SearchBox } from '@/components/search/search-box';
import { SearchControls } from '@/components/search/search-controls';
import { Link } from '@/i18n/navigation';
import { CATEGORY_ICONS } from '@/lib/taxonomy-icons';
import { savedSearches, searchListings, ServiceUnavailableError } from '@/lib/api';
import { currentCountry } from '@/lib/host';
import { sameSearch, savedParams, searchLabels } from '@/lib/search-labels';
import { flatParams, makeLabel } from '@/lib/format';
import {
  CATEGORY_FILTERS,
  href,
  type Params,
  selected,
  withoutKey,
  withParams,
} from '@/lib/search-params';

export const dynamic = 'force-dynamic';

const PASSTHROUGH = [
  'q',
  'understand',
  'category',
  'subcategory',
  'region',
  ...CATEGORY_FILTERS,
  'priceMin',
  'priceMax',
  'near',
  'lat',
  'lon',
  'radiusKm',
  'sort',
  'page',
];
const RANGE_KEYS = ['priceMin', 'priceMax', ...CATEGORY_FILTERS.filter((k) => /M(in|ax)$/.test(k))];

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const t = await getTranslations('search');
  const { q } = flatParams(await searchParams);
  return { title: q ? `${q} – ${t('title')}` : t('title') };
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, format, country] = await Promise.all([
    getTranslations(),
    getFormatter(),
    currentCountry(),
  ]);
  const all = flatParams(await searchParams);
  const requested: Params = Object.fromEntries(
    Object.entries(all).filter(([k]) => PASSTHROUGH.includes(k)),
  );
  let result;
  try {
    result = await searchListings({ ...requested, pageSize: 24 } as unknown as SearchQuery);
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
        {t('search.unavailable')}
      </div>
    );
  }

  // What the query said (ADR-0041) becomes ordinary filters: the sidebar, the chips (each removable)
  // and every link carry them explicitly, with understand=false so they aren't read twice.
  const understood = result.query.understood;
  const current: Params = understood.length
    ? {
        ...withoutKey(requested, 'q'),
        ...Object.assign({}, ...understood.map((u) => u.set)),
        ...(result.query.text ? { q: result.query.text } : {}),
        understand: 'false',
      }
    : requested;
  // With exactly one category chosen, the sidebar shows that category's own filters (FINN-style).
  const categories = selected(current, 'category');
  const only =
    categories.length === 1 && countryOfCategory(categories[0]!) === country
      ? categories[0]!
      : undefined;
  const subcategories = selected(current, 'subcategory');
  const sub = only && subcategories.length === 1 ? subcategories[0] : undefined;

  const pages = Math.max(1, Math.ceil(Math.min(result.total, 200 * 24) / result.pageSize));
  const label = (facet: string) => (value: string) => {
    switch (facet) {
      case 'category':
        return t(`taxonomy.categories.${value}` as never);
      case 'subcategory':
        return t(`taxonomy.subcategories.${value}` as never);
      case 'region':
        return regionName(value);
      case 'make':
        return makeLabel(value);
      default:
        return t(`taxonomy.values.${facet}.${value}` as never);
    }
  };
  const filtered = Object.keys(current).some(
    (k) => k !== 'q' && k !== 'sort' && k !== 'page' && k !== 'understand',
  );
  // Saving a search keeps its filters; "Lagre søk" shows once there is something to keep.
  // A saved search remembers its country, so its alerts search the same marketplace (ADR-0040).
  const toSave = savedParams({ ...current, country });
  const canSave = Object.keys(toSave).length > 1;
  const [saveName, alreadySaved] = canSave
    ? await Promise.all([
        searchLabels(toSave).then((l) => l.join(' · ').slice(0, 80) || t('savedSearches.untitled')),
        savedSearches()
          .then((list) => (list ?? []).some((x) => sameSearch(x.params, toSave)))
          .catch(() => false),
      ])
    : ['', false];
  const facets = [
    'category',
    ...(only || subcategories.length ? ['subcategory'] : []),
    'region',
    ...(only ? facetsOf(only, sub).map((f) => f.key) : []),
  ];
  const ranges = [
    { param: 'price', unit: currencySymbol(result.currency, locale) },
    ...(only ? rangesOf(only, sub) : []).map((r) => ({ param: r.param, unit: r.unit ?? '' })),
  ];
  const rangeTitle = (param: string) =>
    param === 'price' ? t('search.price') : t(`search.ranges.${param}` as never);
  const bound = (param: string, which: 'Min' | 'Max', unit: string) => {
    const value = current[`${param}${which}`] ?? '';
    const n = param === 'year' ? value : format.number(Number(value));
    return t(which === 'Min' ? 'search.rangeFrom' : 'search.rangeTo', {
      filter: rangeTitle(param),
      value: unit ? `${n} ${unit}` : n,
    });
  };
  /** One understood part of the query, in words ("Cars", "near Hargeisa", "Lowest price"). */
  const describe = (u: (typeof understood)[number]): string => {
    const set = u.set;
    if (set.subcategory) return label('subcategory')(set.subcategory);
    if (set.category) return label('category')(set.category);
    if (set.near) return t('search.nearPlace', { place: findPlace(set.near)?.name ?? set.near });
    if (set.region) return label('region')(set.region);
    if (set.sort) return t(`search.sort.${set.sort}` as never);
    const parts = [
      ...(set.priceMin ? [bound('price', 'Min', ranges[0]!.unit)] : []),
      ...(set.priceMax ? [bound('price', 'Max', ranges[0]!.unit)] : []),
    ];
    if (parts.length) return parts.join(', ');
    const [key, value] = Object.entries(set)[0] ?? ['', ''];
    return label(key)(value);
  };
  const chips = [
    ...['category', 'subcategory', 'region', ...CATEGORY_FILTERS].flatMap((key) =>
      RANGE_KEYS.includes(key) ? [] : facetChips(current, key, label(key)),
    ),
    ...ranges.flatMap((r) => [
      ...paramChip(current, `${r.param}Min`, bound(r.param, 'Min', r.unit)),
      ...paramChip(current, `${r.param}Max`, bound(r.param, 'Max', r.unit)),
    ]),
  ];

  return (
    <div className="space-y-6">
      <form action={`/${locale}/search`} method="get" role="search" className="flex gap-2">
        {Object.entries(current)
          .filter(([k]) => k !== 'q' && k !== 'page')
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <SearchBox
          country={country}
          defaultValue={requested.q ?? ''}
          placeholder={t('search.placeholder')}
          label={t('search.placeholder')}
          testId="search-input"
          className="flex-1"
          inputClassName="h-12 w-full rounded-full border border-input bg-card px-5 text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
        <Button type="submit" size="lg" data-testid="search-submit">
          {t('search.submit')}
        </Button>
      </form>

      <div className="grid gap-4 md:grid-cols-[16rem_1fr] md:gap-8">
        <FilterPanel
          title={t('search.filters')}
          showResults={t('search.showResults', { total: result.total })}
          active={chips.length}
          closeLabel={t('search.closeFilters')}
          clear={
            filtered ? (
              <Link
                href={href(current.q ? { q: current.q } : {})}
                className="px-2 text-sm text-primary hover:underline"
              >
                {t('search.clearFilters')}
              </Link>
            ) : null
          }
        >
          {facets.map((facet) => (
            <FacetGroup
              key={facet}
              name={facet}
              title={t(`search.facets.${facet}`)}
              values={result.facets[facet] ?? []}
              params={current}
              label={label(facet)}
              showAll={(count) => t('search.showAll', { count })}
            />
          ))}
          <form
            action={`/${locale}/search`}
            method="get"
            className="space-y-4 pt-2"
            data-testid="price-filter"
          >
            {Object.entries(current)
              .filter(([k]) => !RANGE_KEYS.includes(k) && k !== 'page')
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            {ranges.map((r) => (
              <fieldset key={r.param} data-testid={`range-${r.param}`}>
                <legend className="mb-2 text-sm font-semibold">
                  {rangeTitle(r.param)}
                  {r.unit ? (
                    <span className="font-normal text-muted-foreground"> ({r.unit})</span>
                  ) : null}
                </legend>
                <div className="flex gap-2">
                  {(['Min', 'Max'] as const).map((which) => (
                    <input
                      key={which}
                      name={`${r.param}${which}`}
                      type="number"
                      min={0}
                      step={r.param === 'price' ? 'any' : 1}
                      inputMode={r.param === 'price' ? 'decimal' : 'numeric'}
                      aria-label={`${rangeTitle(r.param)} ${t(`search.price${which}`)}`}
                      placeholder={t(`search.price${which}`)}
                      defaultValue={current[`${r.param}${which}`]}
                      className="h-10 w-full field border-input px-3 text-sm"
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            <Button type="submit" variant="outline" size="sm" className="w-full">
              {t('search.apply')}
            </Button>
          </form>
        </FilterPanel>

        <section aria-labelledby="results-heading" className="space-y-4">
          {only ? (
            <nav aria-label={t('nav.breadcrumb')} className="text-sm text-muted-foreground">
              <ol className="flex flex-wrap items-center gap-1">
                <li>
                  <Link href={`/${only}`} className="hover:underline" data-testid="crumb-category">
                    {t(`taxonomy.categories.${only}` as never)}
                  </Link>
                </li>
                {subcategories.length === 1 ? (
                  <>
                    <li aria-hidden>
                      <ChevronRight className="size-3.5" />
                    </li>
                    <li aria-current="page" className="text-foreground">
                      {t(`taxonomy.subcategories.${subcategories[0]}` as never)}
                    </li>
                  </>
                ) : null}
              </ol>
            </nav>
          ) : null}
          <SearchControls
            params={current}
            country={country}
            sorts={only ? sortsOf(only, sub) : BASE_SORTS}
          />
          {understood.length && requested.q ? (
            <p className="text-sm text-muted-foreground" data-testid="search-understood">
              {t('search.understoodAs', { q: requested.q })} {understood.map(describe).join(' · ')}.{' '}
              <Link
                href={href({ q: requested.q, understand: 'false' })}
                className="font-medium text-primary underline-offset-4 hover:underline"
                data-testid="search-exact-words"
              >
                {t('search.exactWords')}
              </Link>
            </p>
          ) : null}
          {result.relaxed ? (
            <p
              role="status"
              className="rounded-xl bg-soft p-3 text-sm"
              data-testid="search-relaxed"
            >
              {t('search.relaxed')}
            </p>
          ) : null}
          {result.suggestion ? (
            <p className="text-sm" data-testid="search-did-you-mean">
              {t.rich('search.didYouMean', {
                suggestion: () => (
                  <Link
                    href={href({ ...withoutKey(requested, 'page'), q: result.suggestion! })}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {result.suggestion}
                  </Link>
                ),
              })}
            </p>
          ) : null}
          <ActiveFilters
            chips={chips}
            clear={current.q ? { q: current.q } : {}}
            clearLabel={t('search.clearFilters')}
            removeLabel={(filter) => t('search.removeFilter', { filter })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 id="results-heading" className="text-xl font-semibold" data-testid="result-count">
              {t('search.results', { total: result.total })}
            </h1>
            {canSave ? (
              <SaveSearchButton name={saveName} params={toSave} initialSaved={alreadySaved} />
            ) : null}
          </div>
          {result.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <SearchX aria-hidden className="size-10" />
              <p className="font-medium text-foreground">{t('search.noResults')}</p>
              <p>{t('search.noResultsHint')}</p>
              {current.q && filtered ? (
                <Link
                  href={href({ q: current.q })}
                  prefetch={false}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  data-testid="search-everywhere"
                >
                  {t('search.searchEverywhere', { q: current.q })}
                </Link>
              ) : null}
              <nav aria-label={t('search.browseCategories')} className="mt-4 space-y-3">
                <p className="text-sm">{t('search.browseCategories')}</p>
                <ul className="flex flex-wrap justify-center gap-2" role="list">
                  {categoriesOf(country).map(({ id: key }) => {
                    const Icon = CATEGORY_ICONS[key] ?? SearchX;
                    return (
                      <li key={key}>
                        <Link
                          href={href({ category: key })}
                          prefetch={false}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm text-foreground hover:bg-muted"
                        >
                          <Icon aria-hidden className="size-4" />
                          {t(`taxonomy.categories.${key}` as never)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          ) : (
            <ul
              className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 xl:grid-cols-3"
              role="list"
            >
              {result.items.map((hit) => (
                <li key={hit.id} className="flex">
                  <ListingCard hit={hit} />
                </li>
              ))}
            </ul>
          )}
          {pages > 1 ? (
            <nav
              aria-label={t('search.pageOf', { page: result.page, pages })}
              className="flex items-center justify-between pt-4"
            >
              {result.page > 1 ? (
                <Link
                  href={href({
                    ...withParams(current, {}),
                    ...(result.page > 2 ? { page: String(result.page - 1) } : {}),
                  })}
                  rel="prev"
                  className="text-primary hover:underline"
                >
                  ← {t('search.previous')}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted-foreground">
                {t('search.pageOf', { page: result.page, pages })}
              </span>
              {result.page < pages ? (
                <Link
                  href={href({ ...withParams(current, {}), page: String(result.page + 1) })}
                  rel="next"
                  className="text-primary hover:underline"
                  data-testid="next-page"
                >
                  {t('search.next')} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
