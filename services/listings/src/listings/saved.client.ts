import { circuitBreaker, retry } from '@raadi/service-kit';
import { z } from 'zod';

const countsSchema = z.object({ counts: z.record(z.string(), z.number().int().min(0)) });

/**
 * How many people saved each of the owner's listings, from the saved service's internal API,
 * forwarding the user's token (zero trust: saved checks it too). Best effort: My listings must load
 * without it, so a failure returns no counts instead of an error.
 */
export class SavedClient {
  private readonly breaker;

  constructor(private readonly baseUrl: string) {
    this.breaker = circuitBreaker(
      (ids: readonly string[], token: string) =>
        retry(
          async () => {
            const url = new URL('/internal/v1/saved/favourites/counts', this.baseUrl);
            url.searchParams.set('ids', ids.join(','));
            const res = await fetch(url, {
              headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
              signal: AbortSignal.timeout(2000),
            });
            if (!res.ok) throw new Error(`saved returned ${res.status}`);
            return countsSchema.parse(await res.json()).counts;
          },
          { retries: 1, baseDelayMs: 100 },
        ),
      { name: 'saved', timeoutMs: 5000 },
    );
  }

  async favouriteCounts(
    ids: readonly string[],
    token: string,
  ): Promise<Record<string, number> | undefined> {
    if (!ids.length) return {};
    try {
      return await this.breaker.fire(ids, token);
    } catch {
      return undefined;
    }
  }
}
