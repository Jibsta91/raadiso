import {
  RANGE_ATTRIBUTES,
  RANGE_PARAMS,
  type RangeParam,
  type SearchParams,
  findPlace,
} from '@raadi/catalog';

export { searchParamsSchema, type SearchParams } from '@raadi/catalog';

/** Index field of each range parameter (the same name in every category that has it). */
const RANGE_FIELDS = Object.fromEntries(
  Object.values(RANGE_ATTRIBUTES).flatMap((r) => r.map((a) => [a.param, `attributes.${a.field}`])),
) as Record<RangeParam, string>;

/** Facets returned with every search, and the document field each counts. */
export const FACETS = {
  category: 'category',
  subcategory: 'subcategory',
  county: 'county',
  condition: 'attributes.condition',
  fuel: 'attributes.fuel',
  propertyType: 'attributes.propertyType',
  employmentType: 'attributes.employmentType',
  gearbox: 'attributes.gearbox',
  bodyType: 'attributes.bodyType',
  drivetrain: 'attributes.drivetrain',
  ownership: 'attributes.ownership',
  make: 'attributes.make',
} as const;
type Facet = keyof typeof FACETS;

export const PRICE_RANGES = [
  { key: '0-999', to: 1000 },
  { key: '1000-9999', from: 1000, to: 10_000 },
  { key: '10000-99999', from: 10_000, to: 100_000 },
  { key: '100000-999999', from: 100_000, to: 1_000_000 },
  { key: '1000000+', from: 1_000_000 },
] as const;

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
export function buildSearch(p: SearchParams) {
  const must: object[] = [];
  const filter: object[] = [{ term: { status: 'active' } }];

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
  if (p.priceMin !== undefined || p.priceMax !== undefined) {
    filter.push({ range: { priceNok: { gte: p.priceMin, lte: p.priceMax } } });
  }
  for (const name of RANGE_PARAMS) {
    const gte = p[`${name}Min`];
    const lte = p[`${name}Max`];
    if (gte !== undefined || lte !== undefined) {
      filter.push({ range: { [RANGE_FIELDS[name]]: { gte, lte } } });
    }
  }
  if (p.publishedAfter || p.publishedBefore) {
    filter.push({ range: { publishedAt: { gt: p.publishedAfter, lte: p.publishedBefore } } });
  }
  const c = centre(p);
  if (c) filter.push({ geo_distance: { distance: `${p.radiusKm ?? 50}km`, location: c } });

  const selections: Partial<Record<Facet, object>> = {};
  for (const facet of Object.keys(FACETS) as Facet[]) {
    const values = p[facet];
    if (values?.length) selections[facet] = { terms: { [FACETS[facet]]: values } };
  }
  const others = (except?: Facet) =>
    Object.entries(selections)
      .filter(([f]) => f !== except)
      .map(([, clause]) => clause);

  const aggs: Record<string, object> = {};
  for (const facet of Object.keys(FACETS) as Facet[]) {
    aggs[facet] = {
      filter: { bool: { filter: others(facet) } },
      aggs: { values: { terms: { field: FACETS[facet], size: 50 } } },
    };
  }
  aggs.price = {
    filter: { bool: { filter: others() } },
    aggs: { values: { range: { field: 'priceNok', ranges: PRICE_RANGES } } },
  };

  const sort: Array<string | object> = [];
  switch (p.sort) {
    case 'newest':
      sort.push({ publishedAt: 'desc' });
      break;
    case 'price_asc':
      sort.push({ priceNok: { order: 'asc', missing: '_last' } });
      break;
    case 'price_desc':
      sort.push({ priceNok: { order: 'desc', missing: '_last' } });
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
