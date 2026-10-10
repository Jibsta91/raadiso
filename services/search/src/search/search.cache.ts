import type { CountryCode, SearchParams } from '@raadi/catalog';

/**
 * A short in-process cache for anonymous searches: the front page and the category pages ask the same
 * questions for every visitor. Bounded (least recently used goes first), fresh for `ttlMs`, then served
 * stale for up to `staleMs` while one background search refreshes it. Concurrent misses for the same
 * key share one search. Nothing personal is cached: see {@link searchCacheKey}.
 */
export interface ResultCacheOptions {
  /** How long an answer is served as it is (ms). 0 switches the cache off. */
  ttlMs: number;
  /** How long after that a stale answer is still served while it is refreshed (ms). */
  staleMs: number;
  /** The most answers kept. */
  maxEntries: number;
  /**
   * After {@link ResultCache.invalidate}, how long new answers may still miss the change (OpenSearch
   * makes writes searchable after its refresh interval, 1 s): answers stored in this window go stale
   * when it ends, so the next request refreshes them.
   */
  settleMs: number;
  now?: () => number;
}

export type CacheOutcome = 'hit' | 'stale' | 'miss';

interface Entry<T> {
  value: T;
  freshUntil: number;
  staleUntil: number;
  refreshing?: Promise<void>;
}

export class ResultCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly loading = new Map<string, Promise<T>>();
  private readonly now: () => number;
  private settleUntil = 0;
  /** Bumped by invalidate(), so a search that started before it doesn't store an old answer as fresh. */
  private generation = 0;

  constructor(
    private readonly opts: ResultCacheOptions,
    private readonly onRefreshError: (error: unknown) => void = () => undefined,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.opts.ttlMs > 0 && this.opts.maxEntries > 0;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The cached answer for `key`, or `load()`'s, stored for the next caller. */
  async get(key: string, load: () => Promise<T>): Promise<{ value: T; outcome: CacheOutcome }> {
    const now = this.now();
    const entry = this.entries.get(key);
    if (entry && now < entry.staleUntil) {
      // Most recently used goes to the back of the Map; eviction takes from the front.
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (now < entry.freshUntil) return { value: entry.value, outcome: 'hit' };
      entry.refreshing ??= this.load(key, load)
        .then(() => undefined)
        .catch(this.onRefreshError)
        .finally(() => {
          entry.refreshing = undefined;
        });
      return { value: entry.value, outcome: 'stale' };
    }
    if (entry) this.entries.delete(key);
    return { value: await this.load(key, load), outcome: 'miss' };
  }

  /**
   * The index changed: what is cached may be out of date. Every answer is served at most until the
   * change is searchable, then refreshed (stale-while-refresh, so nobody waits for it).
   */
  invalidate(): void {
    const now = this.now();
    this.generation += 1;
    this.settleUntil = now + this.opts.settleMs;
    for (const entry of this.entries.values()) {
      entry.freshUntil = Math.min(entry.freshUntil, this.settleUntil);
      entry.staleUntil = Math.min(entry.staleUntil, this.settleUntil + this.opts.staleMs);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private load(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.loading.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const promise = load()
      .then((value) => {
        this.store(key, value, generation);
        return value;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, promise);
    return promise;
  }

  private store(key: string, value: T, generation: number): void {
    const now = this.now();
    let freshUntil = now + this.opts.ttlMs;
    // Started before the last change, or while it may not be searchable yet: fresh only until it is.
    if (generation !== this.generation || now < this.settleUntil) {
      freshUntil = Math.min(freshUntil, Math.max(now, this.settleUntil));
    }
    this.entries.delete(key);
    this.entries.set(key, { value, freshUntil, staleUntil: freshUntil + this.opts.staleMs });
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}

/**
 * Parameters that make a search personal: the visitor's own position (lat/lon from the browser), and
 * the time windows saved searches use for their alerts (ADR-0026), which are new on every run. Such
 * searches are not cached.
 */
const PERSONAL_PARAMS = ['lat', 'lon', 'publishedAfter', 'publishedBefore'] as const;

/**
 * The cache key for a search, or undefined when it must not be cached: the request carries a user
 * identity, or the parameters are personal. The key is every validated parameter (with its defaults),
 * keys sorted, plus the country actually searched, so two URLs that differ only in parameter order or
 * in naming the default country share an answer. Values are kept as given: the words are echoed back
 * (`query.text`), so they are not folded here.
 */
export function searchCacheKey(
  params: SearchParams,
  country: CountryCode,
  request: { identified: boolean },
): string | undefined {
  if (request.identified) return undefined;
  const raw = params as Record<string, unknown>;
  if (PERSONAL_PARAMS.some((p) => raw[p] !== undefined)) return undefined;
  const entries = Object.entries(raw)
    .filter(([k, v]) => v !== undefined && k !== 'country')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([country, entries]);
}
