import { circuitBreaker } from '@raadi/service-kit';
import { z } from 'zod';

const listingSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: z.enum(['active', 'sold', 'deleted']),
  category: z.string(),
  subcategory: z.string(),
  title: z.string(),
  country: z.string(),
  price: z.object({ amountMinor: z.number().int(), currency: z.string() }).nullable(),
  location: z.object({ name: z.string(), region: z.string() }),
  images: z.array(z.object({ id: z.uuid() })),
  publishedAt: z.string(),
  viewer: z.object({ isOwner: z.boolean() }).optional(),
});

export type PublicListing = z.infer<typeof listingSchema>;

/**
 * Reads a listing from the listings API with the user's token (zero trust:
 * listings checks it too, and tells us whether the user owns the listing).
 */
export class ListingsClient {
  private readonly breaker;

  constructor(private readonly baseUrl: string) {
    this.breaker = circuitBreaker(
      async (listingId: string, token: string) => {
        const res = await fetch(`${this.baseUrl}/api/v1/listings/${listingId}`, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`listings returned ${res.status}`);
        return listingSchema.parse(await res.json());
      },
      { name: 'listings', timeoutMs: 4000 },
    );
  }

  /** The listing, or null if it does not exist (or is deleted). Throws when listings is down. */
  listing(listingId: string, token: string): Promise<PublicListing | null> {
    return this.breaker.fire(listingId, token);
  }
}

const countSchema = z.object({ total: z.number().int().min(0) });

/** Counts matches of a saved search in a time window, through the public search API. */
export class SearchClient {
  private readonly breaker;

  constructor(private readonly baseUrl: string) {
    this.breaker = circuitBreaker(
      async (query: string) => {
        const res = await fetch(`${this.baseUrl}/api/v1/search/listings?${query}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`search returned ${res.status}`);
        return countSchema.parse(await res.json()).total;
      },
      { name: 'search', timeoutMs: 6000 },
    );
  }

  newMatches(params: Record<string, string>, after: Date, until: Date): Promise<number> {
    const query = new URLSearchParams({
      ...params,
      publishedAfter: after.toISOString(),
      publishedBefore: until.toISOString(),
      pageSize: '1',
      sort: 'newest',
    });
    return this.breaker.fire(query.toString());
  }
}
