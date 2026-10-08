import {
  categoriesOf,
  COUNTRIES,
  COUNTRY_CODES,
  type CountryCode,
  facetsOf,
  FACET_KEYS,
  findPlace,
  isCountry,
  RANGE_FIELDS,
  RANGE_PARAMS,
  type SearchParams,
  toMinor,
} from '@raadi/catalog';

export { searchParamsSchema, type SearchParams } from '@raadi/catalog';

/** Facets every search returns, and the document field each counts. */
const BASE_FACETS = { category: 'category', subcategory: 'subcategory', region: 'region' } as const;

/** Every facet the API knows: the base ones and each taxonomy attribute marked as a facet. */
export const FACETS: Readonly<Record<string, string>> = {
  ...BASE_FACETS,
  ...Object.fromEntries(FACET_KEYS.map((k) => [k, `attributes.${k}`])),
};

const COUNTRY_CATEGORIES = Object.fromEntries(
  COUNTRY_CODES.map((c) => [c, categoriesOf(c).map((n) => n.id)]),
) as Record<CountryCode, string[]>;

/**
 * The facets worth counting for a search: with one category selected, that category's own (ADR-0024);
 * otherwise those of every category of the country. Others are left out of the response.
 */
export function facetsFor(p: SearchParams, country: CountryCode): string[] {
  const categories = p.category?.length === 1 ? p.category : undefined;
  const keys = new Set<string>(Object.keys(BASE_FACETS));
  const roots = categories ?? COUNTRY_CATEGORIES[country];
  for (const c of roots) for (const a of facetsOf(c)) keys.add(a.key);
  // A selected facet keeps its counts even if the category changes underneath it.
  for (const k of FACET_KEYS) if ((p[k] as string[] | undefined)?.length) keys.add(k);
  return [...keys];
}

/** The country searched: the request's, else the service's default. */
export function countryOf(p: SearchParams, fallback: CountryCode): CountryCode {
  return isCountry(p.country) ? p.country : fallback;
}

export function centre(p: SearchParams): { lat: number; lon: number } | undefined {
  if (p.lat !== undefined && p.lon !== undefined) return { lat: p.lat, lon: p.lon };
  const place = p.near ? findPlace(p.near) : undefined;
  return place ? { lat: place.lat, lon: place.lon } : undefined;
}

/**
 * Builds the OpenSearch request. Text, price and geo constraints filter the
 * whole result set. Facet selections are applied as a post_filter, and each
 * facet's aggregation applies every selection except its own, so choosing
 * "bil" still shows the counts for the other categories (standard faceting).
 */
export function buildSearch(p: SearchParams, country: CountryCode) {
  const { currency, priceBuckets } = COUNTRIES[country];
  const must: object[] = [];
  const filter: object[] = [{ term: { status: 'active' } }, { term: { country } }];

  if (p.q) {
    must.push({
      bool: {
        should: [
          {
            multi_match: {
              query: p.q,
              fields: ['title^3', 'title.std^2', 'description'],
              type: 'best_fields',
              operator: 'and',
              // One typo up to seven letters, two from eight: with AUTO's two edits at six letters,
              // "sykler" matched "stoler".
              fuzziness: 'AUTO:4,8',
              prefix_length: 1,
            },
          },
          // The last part of a compound word: "sykkel" finds "Terrengsykkel". Exact, so it adds hits
          // without the noise fuzziness would bring on word endings.
          {
            multi_match: {
              query: p.q,
              fields: ['title.suffix^2', 'description.suffix'],
              type: 'best_fields',
              operator: 'and',
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  }
  // Prices are typed in major units of the country's currency; the index holds minor units.
  if (p.priceMin !== undefined || p.priceMax !== undefined) {
    const gte = p.priceMin === undefined ? undefined : toMinor(p.priceMin, currency);
    const lte = p.priceMax === undefined ? undefined : toMinor(p.priceMax, currency);
    filter.push({ range: { priceMinor: { gte, lte } } });
  }
  for (const name of RANGE_PARAMS) {
    const gte = p[`${name}Min`] as number | undefined;
    const lte = p[`${name}Max`] as number | undefined;
    if (gte !== undefined || lte !== undefined) {
      filter.push({ range: { [`attributes.${RANGE_FIELDS[name]}`]: { gte, lte } } });
    }
  }
  if (p.publishedAfter || p.publishedBefore) {
    filter.push({ range: { publishedAt: { gt: p.publishedAfter, lte: p.publishedBefore } } });
  }
  const c = centre(p);
  if (c) filter.push({ geo_distance: { distance: `${p.radiusKm ?? 50}km`, location: c } });

  const selections: Record<string, object> = {};
  for (const [facet, field] of Object.entries(FACETS)) {
    const values = p[facet] as string[] | undefined;
    if (values?.length) selections[facet] = { terms: { [field]: values } };
  }
  const others = (except?: string) =>
    Object.entries(selections)
      .filter(([f]) => f !== except)
      .map(([, clause]) => clause);

  const aggs: Record<string, object> = {};
  for (const facet of facetsFor(p, country)) {
    aggs[facet] = {
      filter: { bool: { filter: others(facet) } },
      aggs: { values: { terms: { field: FACETS[facet], size: 50 } } },
    };
  }
  aggs.price = {
    filter: { bool: { filter: others() } },
    aggs: {
      values: {
        range: {
          field: 'priceMinor',
          ranges: priceBuckets.map((b) => ({
            key: b.key,
            ...(b.from !== undefined ? { from: toMinor(b.from, currency) } : {}),
            ...(b.to !== undefined ? { to: toMinor(b.to, currency) } : {}),
          })),
        },
      },
    },
  };

  const sort: Array<string | object> = [];
  switch (p.sort) {
    case 'newest':
      sort.push({ publishedAt: 'desc' });
      break;
    case 'price_asc':
      sort.push({ priceMinor: { order: 'asc', missing: '_last' } });
      break;
    case 'price_desc':
      sort.push({ priceMinor: { order: 'desc', missing: '_last' } });
      break;
    case 'distance':
      sort.push({ _geo_distance: { location: c, order: 'asc', unit: 'km' } });
      break;
    default:
      sort.push('_score', { publishedAt: 'desc' });
  }
  // Distance is shown on every hit when a centre is known, whatever the sort.
  const scriptFields = c
    ? {
        distance_km: {
          script: {
            source: "doc['location'].arcDistance(params.lat, params.lon) / 1000",
            params: c,
          },
        },
      }
    : undefined;

  return {
    from: (p.page - 1) * p.pageSize,
    size: p.pageSize,
    track_total_hits: true,
    query: {
      bool: {
        must: must.length ? must : [{ match_all: {} }],
        filter,
        // Running paid promotions rank first under "relevance" (ADR-0020). An
        // optional clause: it changes the order, never which listings match.
        // Explicit sorts (newest, price, distance) stay neutral.
        ...(p.sort === 'relevance'
          ? {
              should: [
                {
                  constant_score: {
                    filter: { range: { promotedUntil: { gt: 'now' } } },
                    boost: 1000,
                  },
                },
              ],
            }
          : {}),
      },
    },
    post_filter: { bool: { filter: others() } },
    aggs,
    sort,
    _source: { excludes: ['description', 'ownerId'] },
    ...(scriptFields ? { script_fields: scriptFields } : {}),
  };
}
