import {
  ATTRIBUTE_SORTS,
  categoriesOf,
  COUNTRIES,
  COUNTRY_CODES,
  type CountryCode,
  facetsOf,
  FACET_KEYS,
  findPlace,
  isCountry,
  PRICE_PER_AREA_SORT,
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

/** How to match words (ADR-0041); the defaults are a normal search. */
export interface Matching {
  /** Category and subcategory ids the query named but didn't filter on: ranked higher. */
  boostCategories?: string[];
  /** Attribute values the query named but didn't filter on (`attributes.<key>` → values): ranked higher. */
  boostValues?: Record<string, string[]>;
  /** The retry after no hits: any one word may match, with more typo tolerance. */
  relaxed?: boolean;
  /** Best-match weights (ADR-0042); the defaults unless the ranking lab previews others. */
  weights?: RankingWeights;
}

/** How much quality and freshness multiply relevance under "best match" (ADR-0042). */
export interface RankingWeights {
  quality: number;
  freshness: number;
}
export const DEFAULT_WEIGHTS: RankingWeights = { quality: 0.5, freshness: 0.5 };
/** Freshness: 1 for two days, a half after another 14, then on towards 0 (Gaussian). */
export const FRESHNESS = { offsetDays: 2, scaleDays: 14, decay: 0.5 } as const;

/** (1 + wq × quality) × (1 + wf × freshness); documents without a quality count as average. */
const RANK_SCRIPT = `
double q = doc['quality'].size() == 0 ? 0.5 : doc['quality'].value;
double f = decayDateGauss(params.origin, params.scale, params.offset, params.decay, doc['publishedAt'].value);
return (1 + params.wq * q) * (1 + params.wf * f);`;

/** Freshness of a listing published at `iso`, as the score script computes it (for the lab). */
export function freshnessOf(iso: string, now = Date.now()): number {
  const days = Math.max(0, (now - Date.parse(iso)) / 86_400_000 - FRESHNESS.offsetDays);
  const sigma2 = -(FRESHNESS.scaleDays ** 2) / (2 * Math.log(FRESHNESS.decay));
  return Math.exp(-(days ** 2) / (2 * sigma2));
}

/** Now, to the hour: the freshness origin (so equal searches within an hour score alike). */
export const hourStart = () =>
  new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();

/** The text fields each country's languages are searched in (Somaliland: English and Somali). */
const TEXT_FIELDS: Record<
  CountryCode,
  { title: string[]; description: string[]; compounds: boolean }
> = {
  XS: {
    title: ['title.en^3', 'title.so^3', 'title.std^2'],
    description: ['description.en^0.6', 'description.so^0.6'],
    compounds: false,
  },
  NO: {
    title: ['title^3', 'title.std^2', 'title.en^1.5'],
    description: ['description^0.6', 'description.en^0.3'],
    compounds: true,
  },
};

/** The full-text part: most words must match (all of up to three, then three in four). */
export function textQuery(q: string, country: CountryCode, relaxed = false): object {
  const { title, description, compounds } = TEXT_FIELDS[country];
  const msm = relaxed ? '1' : '3<-25%';
  return {
    bool: {
      should: [
        {
          multi_match: {
            query: q,
            fields: [...title, ...description],
            type: 'best_fields',
            tie_breaker: 0.3,
            minimum_should_match: msm,
            // Typos from five letters (one) and nine (two): shorter words are too often other words.
            fuzziness: relaxed ? 'AUTO:4,7' : 'AUTO:5,9',
            prefix_length: 1,
          },
        },
        // Norwegian compounds put the main word last: "sykkel" finds "Terrengsykkel". Exact, so it adds
        // hits without the noise fuzziness would bring on word endings.
        ...(compounds
          ? [
              {
                multi_match: {
                  query: q,
                  fields: ['title.suffix^2', 'description.suffix'],
                  type: 'best_fields',
                  minimum_should_match: msm,
                },
              },
            ]
          : []),
      ],
      minimum_should_match: 1,
    },
  };
}

/**
 * Builds the OpenSearch request. Text, price and geo constraints filter the
 * whole result set. Facet selections are applied as a post_filter, and each
 * facet's aggregation applies every selection except its own, so choosing
 * "bil" still shows the counts for the other categories (standard faceting).
 */
export function buildSearch(p: SearchParams, country: CountryCode, matching: Matching = {}) {
  const { currency, priceBuckets } = COUNTRIES[country];
  const must: object[] = [];
  const filter: object[] = [{ term: { status: 'active' } }, { term: { country } }];
  const should: object[] = [];

  if (p.q) {
    must.push(textQuery(p.q, country, matching.relaxed));
    // The words as typed, together in the title, rank first ("land cruiser" before "cruiser ... land").
    should.push({ match_phrase: { 'title.std': { query: p.q, slop: 2, boost: 4 } } });
  }
  const nodes = matching.boostCategories ?? [];
  if (nodes.length) {
    should.push(
      { terms: { subcategory: nodes, boost: 3 } },
      { terms: { category: nodes, boost: 2 } },
    );
  }
  for (const [field, values] of Object.entries(matching.boostValues ?? {})) {
    should.push({ terms: { [field]: values, boost: 2 } });
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
    case PRICE_PER_AREA_SORT:
      // Lowest price per square metre; listings without a price or an area last.
      sort.push({
        _script: {
          type: 'number',
          order: 'asc',
          script: {
            lang: 'painless',
            source:
              "doc['priceMinor'].size() == 0 || doc['attributes.areaM2'].size() == 0 || doc['attributes.areaM2'].value == 0 ? Double.MAX_VALUE : doc['priceMinor'].value / (double) doc['attributes.areaM2'].value",
          },
        },
      });
      break;
    default: {
      const own = ATTRIBUTE_SORTS[p.sort];
      if (own) {
        sort.push(
          { [`attributes.${own.field}`]: { order: own.order, missing: '_last' } },
          { publishedAt: 'desc' },
        );
      } else sort.push('_score', { publishedAt: 'desc' });
    }
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
    query:
      p.sort === 'relevance'
        ? {
            // Best match (ADR-0042): relevance × quality × freshness.
            function_score: {
              query: {
                bool: {
                  must: must.length ? must : [{ match_all: {} }],
                  filter,
                  // Under "relevance", running paid promotions rank first (ADR-0020), then phrase and category
                  // boosts (ADR-0041). Optional clauses: they change the order, never which listings match.
                  // Explicit sorts (newest, price, distance) don't score, so they get none.
                  ...(p.sort === 'relevance'
                    ? {
                        should: [
                          {
                            constant_score: {
                              filter: { range: { promotedUntil: { gt: 'now' } } },
                              boost: 1000,
                            },
                          },
                          ...should,
                        ],
                      }
                    : {}),
                },
              },
              functions: [
                {
                  script_score: {
                    script: {
                      source: RANK_SCRIPT,
                      params: {
                        origin: hourStart(),
                        scale: `${FRESHNESS.scaleDays}d`,
                        offset: `${FRESHNESS.offsetDays}d`,
                        decay: FRESHNESS.decay,
                        wq: (matching.weights ?? DEFAULT_WEIGHTS).quality,
                        wf: (matching.weights ?? DEFAULT_WEIGHTS).freshness,
                      },
                    },
                  },
                },
              ],
              boost_mode: 'multiply',
            },
          }
        : {
            bool: {
              must: must.length ? must : [{ match_all: {} }],
              filter,
              // Under "relevance", running paid promotions rank first (ADR-0020), then phrase and category
              // boosts (ADR-0041). Optional clauses: they change the order, never which listings match.
              // Explicit sorts (newest, price, distance) don't score, so they get none.
              ...(p.sort === 'relevance'
                ? {
                    should: [
                      {
                        constant_score: {
                          filter: { range: { promotedUntil: { gt: 'now' } } },
                          boost: 1000,
                        },
                      },
                      ...should,
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
    // "Did you mean": the most frequent close spelling of each word that titles don't contain.
    ...(p.q
      ? {
          suggest: {
            text: p.q,
            spelling: {
              term: { field: 'title.std', suggest_mode: 'popular', min_word_length: 4, size: 1 },
            },
          },
        }
      : {}),
  };
}
