import { Inject, Injectable } from '@nestjs/common';
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
import { buildSearch, centre, countryOf, type Matching, type SearchParams } from './query.js';
import { fold, lexicon, type Understood, understand } from './understand.js';
import type { SearchResponse } from './search.index.js';
import { SearchIndex, toDocument } from './search.index.js';

export const SIGNER = Symbol('IMGPROXY_SIGNER');
/** The country of a search that names none (DEFAULT_COUNTRY). */
export const DEFAULT_COUNTRY = Symbol('DEFAULT_COUNTRY');

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
  ) {}

  async search(params: SearchParams): Promise<SearchResult> {
    const span = trace.getActiveSpan();
    span?.setAttributes({
      'raadi.search.has_query': Boolean(params.q),
      'raadi.search.sort': params.sort,
    });
    const country = countryOf(params, this.defaultCountry);
    span?.setAttribute('raadi.search.country', country);
    // Read the query (ADR-0041) unless asked not to; `effective` is what is searched.
    const reading = params.understand === false ? undefined : understand(params, country);
    const effective = reading?.params ?? params;
    const matching: Matching = {
      boostCategories: reading?.boostCategories,
      boostValues: reading?.boostValues,
    };
    let res = await this.index.search(buildSearch(effective, country, matching));
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

    return {
      country,
      currency,
      total: res.hits.total.value,
      page: params.page,
      pageSize: params.pageSize,
      items: res.hits.hits.map((h) => {
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
          ...(geo && distance !== undefined ? { distanceKm: Math.round(distance * 10) / 10 } : {}),
          ...(first
            ? { image: (({ thumb, card }) => ({ thumb, card }))(imageUrls(this.signer, first)) }
            : {}),
          imageCount: s.imageIds.length,
          attributes: s.attributes,
          publishedAt: s.publishedAt,
          promoted: !!s.promotedUntil && Date.parse(s.promotedUntil) > Date.now(),
        };
      }),
      facets,
      priceRanges,
      query: { text: effective.q ?? '', understood: reading?.understood ?? [] },
      relaxed,
      ...(suggestionOf(effective.q, res) ? { suggestion: suggestionOf(effective.q, res) } : {}),
    };
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
    indexed.add(1, { outcome, type: parsed.type });
    freshness.record((Date.now() - Date.parse(parsed.time)) / 1000);
  }
}
