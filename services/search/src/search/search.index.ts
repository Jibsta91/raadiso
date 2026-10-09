import { Client, errors } from '@opensearch-project/opensearch';
import { attributesOf } from '@raadi/catalog';
import type { ListingSnapshot } from '@raadi/events';
import { circuitBreaker, retry } from '@raadi/service-kit';
import { INDEX_VERSION, indexBody, MIGRATE_SCRIPT } from './index-definition.js';

export interface ListingDocument {
  id: string;
  ownerId: string;
  status: string;
  country: string;
  category: string;
  subcategory: string;
  title: string;
  description: string;
  priceMinor: number | null;
  currency: string | null;
  attributes: Record<string, string | number | boolean>;
  placeId: string;
  placeName: string;
  region: string;
  location: { lat: number; lon: number };
  imageIds: string[];
  /** Photos, for ranking and the console (ADR-0042). */
  imageCount: number;
  /** What the seller gave buyers, 0–1: photos, description, details (ADR-0042). */
  quality: number;
  publishedAt: string;
  updatedAt: string;
  /** End of a paid promotion (ADR-0020), if any. */
  promotedUntil: string | null;
  /** The last price drop (ADR-0044): the price before, and when. */
  previousPriceMinor: number | null;
  priceDroppedAt: string | null;
}

/**
 * How complete a listing is (ADR-0042): photos up to four (half), the description up to 400 characters
 * (a quarter) and the share of the category's details filled in (a quarter). Rounded to two decimals.
 */
export function qualityOf(
  l: Pick<ListingSnapshot, 'imageIds' | 'description' | 'category' | 'subcategory' | 'attributes'>,
): number {
  const photos = Math.min(l.imageIds.length, 4) / 4;
  const text = Math.min(l.description.trim().length, 400) / 400;
  const defs = attributesOf(l.category, l.subcategory);
  const details = defs.length
    ? defs.filter((d) => l.attributes[d.key] !== undefined && l.attributes[d.key] !== '').length /
      defs.length
    : 1;
  return Math.round((0.5 * photos + 0.25 * text + 0.25 * details) * 100) / 100;
}

export function toDocument(l: ListingSnapshot): ListingDocument {
  return {
    id: l.id,
    ownerId: l.ownerId,
    status: l.status,
    // Events from before ADR-0040 carry neither country nor price; they are Norwegian, in kroner.
    country: l.country ?? 'NO',
    category: l.category,
    subcategory: l.subcategory,
    title: l.title,
    description: l.description,
    priceMinor:
      l.price !== undefined
        ? (l.price?.amountMinor ?? null)
        : l.priceNok === null
          ? null
          : l.priceNok * 100,
    currency:
      l.price !== undefined ? (l.price?.currency ?? null) : l.priceNok === null ? null : 'NOK',
    attributes: l.attributes,
    placeId: l.location.placeId,
    placeName: l.location.name,
    region: l.location.region ?? l.location.county,
    location: { lat: l.location.lat, lon: l.location.lon },
    imageIds: l.imageIds,
    imageCount: l.imageIds.length,
    quality: qualityOf(l),
    publishedAt: l.publishedAt,
    updatedAt: l.updatedAt,
    promotedUntil: l.promotedUntil ?? null,
    previousPriceMinor: l.priceDrop?.previous.amountMinor ?? null,
    priceDroppedAt: l.priceDrop?.at ?? null,
  };
}

const isConflict = (e: unknown) => e instanceof errors.ResponseError && e.statusCode === 409;
const isNotFound = (e: unknown) => e instanceof errors.ResponseError && e.statusCode === 404;
const transient = (e: unknown) =>
  !(e instanceof errors.ResponseError) || e.statusCode >= 500 || e.statusCode === 429;

/**
 * The OpenSearch side of search: index lifecycle, idempotent writes and
 * queries. Writes use the listing version as an external version, so a
 * redelivered or out-of-order event can never overwrite newer data.
 */
export class SearchIndex {
  readonly client: Client;
  private readonly query;

  constructor(
    url: string,
    username: string,
    password: string,
    readonly alias: string,
  ) {
    this.client = new Client({
      node: url,
      auth: { username, password },
      requestTimeout: 10_000,
      maxRetries: 2,
    });
    this.query = circuitBreaker(
      (body: Record<string, unknown>) => this.client.search({ index: this.alias, body }),
      { name: 'opensearch-search', timeoutMs: 10_000 },
    );
  }

  get indexName(): string {
    return `${this.alias}-v${INDEX_VERSION}`;
  }

  /**
   * Creates the versioned index and points the alias at it (idempotent). After
   * an INDEX_VERSION bump the documents are copied from the previous index
   * (keeping their external versions) before the alias moves in one atomic
   * step, so search never answers from an empty or doubled index. This runs
   * before the consumer starts, so nothing writes during the copy.
   */
  async ensureIndex(): Promise<void> {
    await retry(
      async () => {
        const exists = await this.client.indices.exists({ index: this.indexName });
        if (!exists.body) {
          await this.client.indices
            // The client's typings are stricter than the REST API for this static body.
            .create({ index: this.indexName, body: indexBody as never })
            .catch((e: unknown) => {
              if (!(
                e instanceof errors.ResponseError &&
                e.body?.error?.type === 'resource_already_exists_exception'
              ))
                throw e;
            });
        }
        const previous = (await this.aliasTargets()).filter((i) => i !== this.indexName);
        for (const source of previous) {
          await this.client.reindex({
            body: {
              conflicts: 'proceed',
              source: { index: source },
              dest: { index: this.indexName, version_type: 'external' },
              script: { lang: 'painless', source: MIGRATE_SCRIPT },
            },
            refresh: true,
            wait_for_completion: true,
          });
        }
        await this.client.indices.updateAliases({
          body: {
            actions: [
              ...previous.map((index) => ({ remove: { index, alias: this.alias } })),
              { add: { index: this.indexName, alias: this.alias, is_write_index: true } },
            ],
          },
        });
      },
      { retries: 10, baseDelayMs: 500, shouldRetry: transient },
    );
  }

  /**
   * Indices the alias currently points at (none on first start). Scoped to
   * this service's own indices: its OpenSearch user may not read the others.
   */
  private async aliasTargets(): Promise<string[]> {
    try {
      const res = await this.client.indices.getAlias({
        index: `${this.alias}-v*`,
        name: this.alias,
      });
      return Object.keys(res.body as Record<string, unknown>);
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }

  async upsert(doc: ListingDocument, version: number): Promise<'indexed' | 'stale'> {
    try {
      await this.client.index({
        index: this.alias,
        id: doc.id,
        body: doc,
        version,
        version_type: 'external',
      });
      return 'indexed';
    } catch (e) {
      if (isConflict(e)) return 'stale';
      throw e;
    }
  }

  async remove(id: string, version: number): Promise<'deleted' | 'stale'> {
    try {
      await this.client.delete({ index: this.alias, id, version, version_type: 'external' });
      return 'deleted';
    } catch (e) {
      if (isConflict(e) || isNotFound(e)) return 'stale';
      throw e;
    }
  }

  async search(body: Record<string, unknown>) {
    const res = await this.query.fire(body);
    return res.body as unknown as SearchResponse;
  }

  async count(): Promise<number> {
    const res = await this.client.count({ index: this.alias });
    return res.body.count;
  }

  async ping(): Promise<void> {
    const res = await this.client.cluster.health({ index: this.alias, timeout: '1s' });
    if (res.body.status === 'red') throw new Error('index is red');
  }
}

export interface SearchResponse {
  took: number;
  hits: {
    total: { value: number };
    hits: Array<{
      _id: string;
      _score: number | null;
      _source: Omit<ListingDocument, 'description' | 'ownerId'>;
      fields?: { distance_km?: number[] };
      sort?: unknown[];
    }>;
  };
  aggregations: Record<
    string,
    { values: { buckets: Array<{ key: string; doc_count: number; from?: number; to?: number }> } }
  >;
  /** Term suggestions, when the request asked for them ("did you mean"). */
  suggest?: Record<
    string,
    Array<{ text: string; offset: number; length: number; options: Array<{ text: string }> }>
  >;
}
