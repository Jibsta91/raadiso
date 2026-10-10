import { Inject, Injectable, Optional } from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';
import {
  type CountryCode,
  COUNTRIES,
  isCountry,
  type Money,
  parentOf,
  placeName,
  placesOf,
  regionName,
} from '@raadi/catalog';
import { parseEvent } from '@raadi/events';
import { imageUrls, type ImgproxySigner } from '@raadi/service-kit';
import { PermanentEventError, type ReceivedEvent } from '@raadi/service-kit/kafka';
import {
  buildSearch,
  centre,
  countryOf,
  DEFAULT_WEIGHTS,
  freshnessOf,
  hourStart,
  type Matching,
  PRICE_DROP_DAYS,
  type RankingWeights,
  type SearchParams,
} from './query.js';
import { fold, lexicon, type Understood, understand } from './understand.js';
import {
  type DealRating,
  groupKey,
  LOOSENESS,
  type PriceStats,
  type PriceTarget,
  rate,
  readStats,
  statsBody,
  unitPrice,
} from './price.js';
import { ResultCache, searchCacheKey } from './search.cache.js';
import type { SearchResponse } from './search.index.js';
import { SearchIndex, toDocument } from './search.index.js';

export const SIGNER = Symbol('IMGPROXY_SIGNER');
/** The country of a search that names none (DEFAULT_COUNTRY). */
export const DEFAULT_COUNTRY = Symbol('DEFAULT_COUNTRY');
/** Whether price insight is on (PRICE_INSIGHT, ADR-0050). */
export const PRICE_INSIGHT = Symbol('PRICE_INSIGHT');
/** The short cache of anonymous searches (search.cache.ts); none in tests that build the service. */
export const SEARCH_CACHE = Symbol('SEARCH_CACHE');

const meter = metrics.getMeter('search');
const indexed = meter.createCounter('raadi.search.indexed', {
  description: 'Index operations from listing events, by outcome (indexed, deleted, stale)',
});
const freshness = meter.createHistogram('raadi.search.index.lag', {
  description: 'Time from the listing change to it being searchable',
  unit: 's',
});
const queries = meter.createHistogram('raadi.search.query.duration', {
  description: 'OpenSearch time per search request',
  unit: 's',
});
const cacheRequests = meter.createCounter('raadi.search.cache.requests', {
  description:
    'Listing searches by cache outcome: hit (fresh), stale (served while refreshed), miss, bypass (personal)',
});
const cacheEntries = meter.createObservableGauge('raadi.search.cache.entries', {
  description: 'Answers held in the search cache',
});

export interface SearchHit {
  id: string;
  title: string;
  country: string;
  price: Money | null;
  category: string;
  subcategory: string;
  location: {
    placeId: string;
    name: string;
    region: string;
    regionName: string;
    lat: number;
    lon: number;
  };
  distanceKm?: number;
  /** A good price against comparable listings (ADR-0043); only good news is shown in lists. */
  deal?: 'great' | 'good';
  /** A recent price drop (ADR-0044): the price before, and when. */
  priceDrop?: { previous: Money; at: string };
  image?: { thumb: string; card: string };
  imageCount: number;
  attributes: Record<string, string | number | boolean>;
  publishedAt: string;
  promoted: boolean;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface Autocomplete {
  categories: Array<{ category: string; subcategory?: string; count: number }>;
  queries: string[];
  places: Array<{ placeId: string; name: string }>;
}

/** A listing's price against comparable listings (ADR-0043). */
export interface PriceInsight {
  listingId: string;
  currency: string;
  /** The listing's price per unit, in minor units. */
  unitPrice: number;
  rating: DealRating;
  stats: PriceStats;
}

/** One listing in the ranking lab: its score taken apart (ADR-0042). */
export interface RankedListing {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  imageCount: number;
  publishedAt: string;
  promoted: boolean;
  /** Text relevance and the query's boosts, before the multipliers. */
  relevance: number;
  quality: number;
  freshness: number;
  /** (1 + wq × quality) × (1 + wf × freshness). */
  multiplier: number;
  score: number;
}

export interface RankingLab {
  weights: RankingWeights;
  defaults: RankingWeights;
  query: { text: string; understood: Understood[] };
  total: number;
  items: RankedListing[];
}

export interface PriceBucketCount {
  key: string;
  /** Major units of `currency`, inclusive. */
  from?: number;
  /** Major units of `currency`, exclusive. */
  to?: number;
  count: number;
}

export interface SearchResult {
  /** The country searched, and its currency (prices in the price facet are in it). */
  country: CountryCode;
  currency: string;
  total: number;
  page: number;
  pageSize: number;
  items: SearchHit[];
  /** The facets relevant to the search (category, subcategory, region and attribute facets). */
  facets: Record<string, FacetValue[]>;
  priceRanges: PriceBucketCount[];
  /** How the query was read (ADR-0041): the words searched as text, and what else they meant. */
  query: { text: string; understood: Understood[] };
  /** No listing matched every word: these match some of them. */
  relaxed: boolean;
  /** A spelling that would match more listings ("did you mean"). */
  suggestion?: string;
}

/** A drop in the last PRICE_DROP_DAYS days, as the hit shows it. */
function recentDrop(s: {
  previousPriceMinor?: number | null;
  priceDroppedAt?: string | null;
  currency: string | null;
}): { previous: Money; at: string } | undefined {
  if (s.previousPriceMinor == null || !s.priceDroppedAt || !s.currency) return undefined;
  if (Date.now() - Date.parse(s.priceDroppedAt) > PRICE_DROP_DAYS * 86_400_000) return undefined;
  return {
    previous: { amountMinor: s.previousPriceMinor, currency: s.currency },
    at: s.priceDroppedAt,
  };
}

/** The query with each misspelled word replaced by its suggestion, when there is one and few hits. */
export function suggestionOf(q: string | undefined, res: SearchResponse): string | undefined {
  const words = res.suggest?.spelling;
  if (!q || !words || res.hits.total.value >= 3) return undefined;
  let out = q;
  for (const w of [...words].reverse()) {
    const better = w.options[0]?.text;
    if (better && better !== w.text)
      out = out.slice(0, w.offset) + better + out.slice(w.offset + w.length);
  }
  return out !== q ? out : undefined;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly index: SearchIndex,
    @Inject(SIGNER) private readonly signer: ImgproxySigner,
    @Inject(DEFAULT_COUNTRY) private readonly defaultCountry: CountryCode,
    @Inject(PRICE_INSIGHT) private readonly priceInsightOn: boolean = true,
    @Optional() @Inject(SEARCH_CACHE) private readonly cache?: ResultCache<SearchResult>,
  ) {
    if (cache?.enabled) cacheEntries.addCallback((r) => r.observe(cache.size));
  }

  /**
   * {@link search} through the short cache when the request is anonymous and the parameters are not
   * personal (search.cache.ts); `identified` is true when the request carries a user's token.
   */
  async searchCached(
    params: SearchParams,
    request: { identified: boolean },
  ): Promise<SearchResult> {
    const cache = this.cache;
    if (!cache?.enabled) return this.search(params);
    const key = searchCacheKey(params, countryOf(params, this.defaultCountry), request);
    if (key === undefined) {
      cacheRequests.add(1, { outcome: 'bypass' });
      return this.search(params);
    }
    const { value, outcome } = await cache.get(key, () => this.search(params));
    cacheRequests.add(1, { outcome });
    trace.getActiveSpan()?.setAttribute('raadi.search.cache', outcome);
    return value;
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const span = trace.getActiveSpan();
    span?.setAttributes({
      'raadi.search.has_query': Boolean(params.q),
      'raadi.search.sort': params.sort,
    });
    const country = countryOf(params, this.defaultCountry);
    span?.setAttribute('raadi.search.country', country);
    // Read the query (ADR-0041) unless asked not to; `effective` is what is searched.
    let reading = params.understand === false ? undefined : understand(params, country);
    let effective = reading?.params ?? params;
    let matching: Matching = {
      boostCategories: reading?.boostCategories,
      boostValues: reading?.boostValues,
    };
    let res = await this.index.search(buildSearch(effective, country, matching));
    // Reading the query must never hide what its words alone find (a bike filed under Hobby).
    if (res.hits.total.value === 0 && reading?.understood.length) {
      const literal = await this.index.search(buildSearch(params, country));
      if (literal.hits.total.value > 0) {
        res = literal;
        reading = undefined;
        effective = params;
        matching = {};
      }
    }
    let relaxed = false;
    // No dead ends: with no hits, let any one word match.
    if (res.hits.total.value === 0 && effective.q) {
      const looser = await this.index.search(
        buildSearch(effective, country, { ...matching, relaxed: true }),
      );
      if (looser.hits.total.value > 0) {
        res = looser;
        relaxed = true;
      }
    }
    span?.setAttributes({
      'raadi.search.understood': reading?.understood.length ?? 0,
      'raadi.search.relaxed': relaxed,
      'raadi.search.hits': res.hits.total.value,
    });
    queries.record(res.took / 1000, { sort: params.sort, text: params.q ? 'yes' : 'no', country });
    const geo = centre(effective);

    const facets: Record<string, FacetValue[]> = {};
    for (const [facet, agg] of Object.entries(res.aggregations)) {
      if (facet === 'price') continue;
      facets[facet] = (agg.values.buckets ?? []).map((b) => ({ value: b.key, count: b.doc_count }));
    }
    const { currency, priceBuckets } = COUNTRIES[country];
    const priceRanges = priceBuckets.map((bucket, i) => ({
      key: bucket.key,
      ...(bucket.from !== undefined ? { from: bucket.from } : {}),
      ...(bucket.to !== undefined ? { to: bucket.to } : {}),
      count: res.aggregations.price?.values.buckets[i]?.doc_count ?? 0,
    }));

    const deals = await this.deals(res).catch(() => new Map<string, 'great' | 'good'>());

    return {
      country,
      currency,
      total: res.hits.total.value,
      page: params.page,
      pageSize: params.pageSize,
      items: this.toHits(res, deals, geo !== undefined),
      facets,
      priceRanges,
      query: { text: effective.q ?? '', understood: reading?.understood ?? [] },
      relaxed,
      ...(suggestionOf(effective.q, res) ? { suggestion: suggestionOf(effective.q, res) } : {}),
    };
  }

  /**
   * The ranking lab (ADR-0042): best match for a query with the given weights, each listing's score
   * taken apart. A preview: nothing is saved.
   */
  async rankingLab(params: SearchParams, weights: RankingWeights): Promise<RankingLab> {
    const country = countryOf(params, this.defaultCountry);
    const reading = params.understand === false ? undefined : understand(params, country);
    const effective = { ...(reading?.params ?? params), sort: 'relevance' as const };
    const res = await this.index.search(
      buildSearch(effective, country, {
        boostCategories: reading?.boostCategories,
        boostValues: reading?.boostValues,
        weights,
      }),
    );
    const origin = Date.parse(hourStart());
    return {
      weights,
      defaults: DEFAULT_WEIGHTS,
      query: { text: effective.q ?? '', understood: reading?.understood ?? [] },
      total: res.hits.total.value,
      items: res.hits.hits.map((h) => {
        const s = h._source;
        const quality = s.quality ?? 0.5;
        const freshness = freshnessOf(s.publishedAt, origin);
        const multiplier = (1 + weights.quality * quality) * (1 + weights.freshness * freshness);
        const promoted = !!s.promotedUntil && Date.parse(s.promotedUntil) > Date.now();
        const score = h._score ?? 0;
        return {
          id: s.id,
          title: s.title,
          category: s.category,
          subcategory: s.subcategory,
          imageCount: s.imageCount ?? s.imageIds.length,
          publishedAt: s.publishedAt,
          promoted,
          relevance: Math.round((score / multiplier - (promoted ? 1000 : 0)) * 1000) / 1000,
          quality,
          freshness: Math.round(freshness * 1000) / 1000,
          multiplier: Math.round(multiplier * 1000) / 1000,
          score: Math.round(score * 1000) / 1000,
        };
      }),
    };
  }

  /** Search hits as the API returns them. */
  private toHits(
    res: SearchResponse,
    deals: Map<string, 'great' | 'good'> = new Map(),
    withDistance = false,
  ): SearchHit[] {
    return res.hits.hits.map((h) => {
      const s = h._source;
      const first = s.imageIds[0];
      const distance = h.fields?.distance_km?.[0];
      return {
        id: s.id,
        title: s.title,
        country: s.country,
        price:
          s.priceMinor === null || s.currency === null
            ? null
            : { amountMinor: s.priceMinor, currency: s.currency },
        category: s.category,
        subcategory: s.subcategory,
        location: {
          placeId: s.placeId,
          name: s.placeName,
          region: s.region,
          regionName: regionName(s.region),
          lat: s.location.lat,
          lon: s.location.lon,
        },
        ...(withDistance && distance !== undefined
          ? { distanceKm: Math.round(distance * 10) / 10 }
          : {}),
        ...(deals.has(s.id) ? { deal: deals.get(s.id) } : {}),
        ...(recentDrop(s) ? { priceDrop: recentDrop(s)! } : {}),
        ...(first
          ? { image: (({ thumb, card }) => ({ thumb, card }))(imageUrls(this.signer, first)) }
          : {}),
        imageCount: s.imageIds.length,
        attributes: s.attributes,
        publishedAt: s.publishedAt,
        promoted: !!s.promotedUntil && Date.parse(s.promotedUntil) > Date.now(),
      };
    });
  }

  /**
   * Listings like this one (ADR-0047): more-like-this on its words, in its country, the same
   * subcategory and a similar price ranking higher; topped up with its subcategory's newest when the
   * words find too few. Empty for an unknown listing.
   */
  async similar(id: string, size = 8): Promise<SearchHit[]> {
    const doc = (await this.index.search({ size: 1, query: { ids: { values: [id] } } })).hits
      .hits[0]?._source;
    if (!doc) return [];
    const fields =
      doc.country === 'NO'
        ? ['title', 'title.std', 'description']
        : ['title.en', 'title.so', 'description.en'];
    const base = [{ term: { status: 'active' } }, { term: { country: doc.country } }];
    const should: object[] = [
      { term: { subcategory: { value: doc.subcategory, boost: 3 } } },
      { term: { category: { value: doc.category, boost: 1 } } },
    ];
    if (doc.priceMinor !== null) {
      should.push({
        range: { priceMinor: { gte: doc.priceMinor * 0.5, lte: doc.priceMinor * 1.5, boost: 1.5 } },
      });
    }
    const res = await this.index.search({
      size,
      _source: { excludes: ['description', 'ownerId'] },
      query: {
        bool: {
          must: [
            {
              more_like_this: {
                fields,
                like: [{ _index: this.index.alias, _id: id }],
                min_term_freq: 1,
                min_doc_freq: 1,
                max_query_terms: 12,
                minimum_should_match: '30%',
              },
            },
          ],
          filter: base,
          should,
          must_not: [{ ids: { values: [id] } }],
        },
      },
    });
    const hits = this.toHits(res);
    if (hits.length >= size) return hits;
    const more = await this.index.search({
      size: size - hits.length,
      _source: { excludes: ['description', 'ownerId'] },
      query: {
        bool: {
          filter: [...base, { term: { subcategory: doc.subcategory } }],
          must_not: [{ ids: { values: [id, ...hits.map((h) => h.id)] } }],
        },
      },
      sort: [{ publishedAt: 'desc' }],
    });
    return [...hits, ...this.toHits(more)];
  }

  /** Price statistics per comparable group, for a minute (ADR-0043). */
  private priceCache = new Map<string, { at: number; stats: PriceStats | undefined }>();

  /** Statistics for many targets at once: cached groups first, the rest in one multi-search each pass. */
  private async statsFor(targets: PriceTarget[]): Promise<Array<PriceStats | undefined>> {
    const out: Array<PriceStats | undefined> = targets.map(() => undefined);
    let todo = targets.map((t, i) => ({ t, i }));
    for (const level of LOOSENESS) {
      const missing = new Map<string, PriceTarget>();
      const next: typeof todo = [];
      for (const { t, i } of todo) {
        const key = groupKey(t, level);
        const hit = this.priceCache.get(key);
        if (hit && Date.now() - hit.at < 60_000) {
          if (hit.stats) out[i] = hit.stats;
          else next.push({ t, i });
        } else {
          missing.set(key, t);
          next.push({ t, i });
        }
      }
      if (missing.size) {
        const keys = [...missing.keys()];
        const body = keys.flatMap((k) => [
          { index: this.index.alias },
          statsBody({ ...missing.get(k)!, id: undefined }, level),
        ]);
        const res = await this.index.client.msearch({ body } as never);
        const responses = (res.body as { responses: Array<Record<string, unknown>> }).responses;
        keys.forEach((k, n) => {
          const r = responses[n] as {
            hits?: { total: { value: number } };
            aggregations?: Record<string, unknown>;
          };
          const stats = r.hits ? readStats(missing.get(k)!, level, r as never) : undefined;
          this.priceCache.set(k, { at: Date.now(), stats });
        });
      }
      todo = [];
      for (const { t, i } of next) {
        const stats = this.priceCache.get(groupKey(t, level))?.stats;
        if (stats) out[i] = stats;
        else todo.push({ t, i });
      }
      if (!todo.length) break;
    }
    return out;
  }

  /** "Great price" and "good price" for a page of hits (only good news in lists). */
  private async deals(res: SearchResponse): Promise<Map<string, 'great' | 'good'>> {
    if (!this.priceInsightOn) return new Map();
    const priced = res.hits.hits.map((h) => h._source).filter((s) => s.priceMinor !== null);
    const targets = priced.map((s) => ({
      country: s.country,
      category: s.category,
      subcategory: s.subcategory,
      region: s.region,
      attributes: s.attributes,
    }));
    const stats = await this.statsFor(targets);
    const out = new Map<string, 'great' | 'good'>();
    priced.forEach((s, i) => {
      const st = stats[i];
      const unit = st && unitPrice(s.priceMinor!, st.unit, s.attributes);
      if (!st || unit === undefined) return;
      const rating = rate(unit, st);
      if (rating === 'great' || rating === 'good') out.set(s.id, rating);
    });
    return out;
  }

  /** A listing's price against its comparables (the listing excluded); null without enough. */
  async priceInsight(id: string): Promise<PriceInsight | null> {
    if (!this.priceInsightOn) return null;
    const res = await this.index.search({ size: 1, query: { ids: { values: [id] } } });
    const doc = res.hits.hits[0]?._source;
    if (!doc || doc.priceMinor === null || doc.currency === null) return null;
    const target: PriceTarget = {
      id,
      country: doc.country,
      category: doc.category,
      subcategory: doc.subcategory,
      region: doc.region,
      attributes: doc.attributes,
    };
    for (const level of LOOSENESS) {
      const r = await this.index.search(statsBody(target, level) as Record<string, unknown>);
      const stats = readStats(target, level, r);
      if (!stats) continue;
      const price = unitPrice(doc.priceMinor, stats.unit, doc.attributes);
      if (price === undefined) return null;
      return {
        listingId: id,
        currency: doc.currency,
        unitPrice: Math.round(price),
        rating: rate(price, stats),
        stats,
      };
    }
    return null;
  }

  /** What comparable listings cost, for a seller filling in the form (ADR-0043). */
  async priceGuide(t: PriceTarget): Promise<(PriceStats & { currency: string }) | null> {
    if (!this.priceInsightOn) return null;
    const [stats] = await this.statsFor([t]);
    return stats ? { ...stats, currency: COUNTRIES[t.country as CountryCode].currency } : null;
  }

  /** Listings per category and subcategory, per country, for autocomplete (cached for a minute). */
  private counts = new Map<CountryCode, { at: number; counts: Map<string, number> }>();

  private async categoryCounts(country: CountryCode): Promise<Map<string, number>> {
    const hit = this.counts.get(country);
    if (hit && Date.now() - hit.at < 60_000) return hit.counts;
    const res = await this.index.search({
      size: 0,
      query: { bool: { filter: [{ term: { status: 'active' } }, { term: { country } }] } },
      aggs: {
        category: { terms: { field: 'category', size: 100 } },
        subcategory: { terms: { field: 'subcategory', size: 500 } },
      },
    });
    const counts = new Map<string, number>();
    for (const agg of [res.aggregations.category, res.aggregations.subcategory])
      for (const b of (agg as unknown as { buckets: Array<{ key: string; doc_count: number }> })
        .buckets)
        counts.set(b.key, b.doc_count);
    this.counts.set(country, { at: Date.now(), counts });
    return counts;
  }

  /**
   * What to offer while someone types (ADR-0041): categories whose words start with what was typed
   * (with listing counts), title completions, and places. In one country.
   */
  async autocomplete(q: string, country?: string): Promise<Autocomplete> {
    const where: CountryCode = isCountry(country) ? country : this.defaultCountry;
    const typed = fold(q.trim());
    const [counts, queries] = await Promise.all([
      this.categoryCounts(where),
      this.suggest(q, where).catch(() => []),
    ]);
    // Categories: a lexicon phrase that starts with the input, or a phrase the input starts with.
    const ids = new Map<string, number>();
    for (const [phrase, meanings] of lexicon(where)) {
      const rank =
        phrase === typed
          ? 0
          : phrase.startsWith(typed)
            ? 1
            : typed.startsWith(`${phrase} `)
              ? 2
              : -1;
      if (rank < 0) continue;
      for (const m of meanings) {
        const id = m.kind === 'node' ? m.id : m.kind === 'value' ? m.also : undefined;
        if (id && (ids.get(id) ?? 9) > rank) ids.set(id, rank);
      }
    }
    const categories = [...ids.entries()]
      .map(([id, rank]) => ({
        category: parentOf(id) ?? id,
        ...(parentOf(id) ? { subcategory: id } : {}),
        count: counts.get(id) ?? 0,
        rank,
      }))
      .filter((c) => c.count > 0)
      .sort((a, b) => a.rank - b.rank || b.count - a.count)
      .slice(0, 4)
      .map(({ rank: _rank, ...c }) => c);
    const places = placesOf(where)
      .filter((p) => COUNTRIES[where].locales.some((l) => fold(placeName(p, l)).startsWith(typed)))
      .slice(0, 3)
      .map((p) => ({ placeId: p.id, name: p.name }));
    return { categories, queries: queries.slice(0, 6), places };
  }

  /** Title suggestions for search-as-you-type, in one country. */
  async suggest(q: string, country?: string): Promise<string[]> {
    const where = country && Object.hasOwn(COUNTRIES, country) ? country : this.defaultCountry;
    const res = await this.index.search({
      size: 0,
      query: {
        bool: {
          must: [{ match: { 'title.prefix': { query: q, operator: 'and' } } }],
          filter: [{ term: { status: 'active' } }, { term: { country: where } }],
        },
      },
      aggs: { titles: { terms: { field: 'title.raw', size: 8 } } },
    });
    const buckets = (res.aggregations as unknown as { titles: { buckets: Array<{ key: string }> } })
      .titles.buckets;
    return buckets.map((b) => b.key);
  }

  /** Kafka handler for raadi.listing.events (idempotent via external versions). */
  async onListingEvent(event: ReceivedEvent): Promise<void> {
    let parsed;
    try {
      parsed = parseEvent(event.value);
    } catch (error) {
      throw new PermanentEventError('listing event violates its contract', { cause: error });
    }
    if (!parsed) return;
    let outcome: string;
    switch (parsed.type) {
      case 'no.raadi.listings.listing.published.v1':
      case 'no.raadi.listings.listing.updated.v1': {
        const { listing } = parsed.data;
        outcome =
          listing.status === 'deleted'
            ? await this.index.remove(listing.id, listing.version)
            : await this.index.upsert(toDocument(listing), listing.version);
        break;
      }
      case 'no.raadi.listings.listing.deleted.v1':
        outcome = await this.index.remove(parsed.data.listingId, parsed.data.version);
        break;
      default:
        return;
    }
    // Cached answers may now be out of date: refreshed once the change is searchable.
    this.cache?.invalidate();
    indexed.add(1, { outcome, type: parsed.type });
    freshness.record((Date.now() - Date.parse(parsed.time)) / 1000);
  }
}
