import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imgproxySigner } from '@raadi/service-kit';
import { type SearchParams, searchParamsSchema } from '../../src/search/query.js';
import { ResultCache, searchCacheKey } from '../../src/search/search.cache.js';
import type { SearchIndex } from '../../src/search/search.index.js';
import { type SearchResult, SearchService } from '../../src/search/search.service.js';

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

function cache(c = clock(), opts: Partial<ConstructorParameters<typeof ResultCache>[0]> = {}) {
  return new ResultCache<string>({
    ttlMs: 15_000,
    staleMs: 30_000,
    maxEntries: 3,
    settleMs: 1_500,
    now: c.now,
    ...opts,
  });
}

/** A loader that counts its calls and answers "v1", "v2", ... */
function loader() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    load: async () => `v${++calls}`,
  };
}

describe('ResultCache', () => {
  it('answers a repeat from the cache while it is fresh', async () => {
    const c = clock();
    const rc = cache(c);
    const l = loader();
    assert.deepEqual(await rc.get('k', l.load), { value: 'v1', outcome: 'miss' });
    c.advance(14_999);
    assert.deepEqual(await rc.get('k', l.load), { value: 'v1', outcome: 'hit' });
    assert.equal(l.calls, 1);
  });

  it('serves a stale answer at once and refreshes it once in the background', async () => {
    const c = clock();
    const rc = cache(c);
    const l = loader();
    await rc.get('k', l.load);
    c.advance(15_000);
    // A refresh that takes a while: both callers get the stale answer, and it runs once.
    let refreshes = 0;
    let release: () => void = () => undefined;
    const slow = () => {
      refreshes += 1;
      return new Promise<string>((r) => (release = () => r('v2')));
    };
    assert.deepEqual(await rc.get('k', slow), { value: 'v1', outcome: 'stale' });
    assert.deepEqual(await rc.get('k', slow), { value: 'v1', outcome: 'stale' });
    assert.equal(refreshes, 1, 'one refresh for two stale answers');
    release();
    await settled();
    assert.deepEqual(await rc.get('k', l.load), { value: 'v2', outcome: 'hit' });
    assert.equal(l.calls, 1);
  });

  it('expires an answer that is too old to serve stale', async () => {
    const c = clock();
    const rc = cache(c);
    const l = loader();
    await rc.get('k', l.load);
    c.advance(45_000);
    assert.deepEqual(await rc.get('k', l.load), { value: 'v2', outcome: 'miss' });
  });

  it('shares one search between concurrent misses', async () => {
    const rc = cache();
    const l = loader();
    const [a, b] = await Promise.all([rc.get('k', l.load), rc.get('k', l.load)]);
    assert.equal(a.value, 'v1');
    assert.equal(b.value, 'v1');
    assert.equal(l.calls, 1);
  });

  it('never caches a failure, and keeps the stale answer when a refresh fails', async () => {
    const c = clock();
    const errors: unknown[] = [];
    const rc = new ResultCache<string>(
      { ttlMs: 15_000, staleMs: 30_000, maxEntries: 3, settleMs: 1_500, now: c.now },
      (e) => errors.push(e),
    );
    await assert.rejects(
      rc.get('k', () => Promise.reject(new Error('down'))),
      /down/,
    );
    assert.equal(rc.size, 0);
    await rc.get('k', async () => 'v1');
    c.advance(15_000);
    const stale = await rc.get('k', () => Promise.reject(new Error('down')));
    assert.deepEqual(stale, { value: 'v1', outcome: 'stale' });
    await settled();
    assert.equal(errors.length, 1);
    assert.equal((await rc.get('k', async () => 'v2')).value, 'v1', 'still served stale');
  });

  it('evicts the least recently used answer when full', async () => {
    const rc = cache();
    for (const k of ['a', 'b', 'c']) await rc.get(k, async () => k);
    await rc.get('a', async () => 'a2'); // a is now the most recently used
    await rc.get('d', async () => 'd');
    assert.equal(rc.size, 3);
    assert.equal((await rc.get('a', async () => 'a3')).outcome, 'hit');
    assert.equal((await rc.get('b', async () => 'b2')).outcome, 'miss', 'b was evicted');
  });

  it('refreshes everything once an index change is searchable', async () => {
    const c = clock();
    const rc = cache(c);
    const l = loader();
    await rc.get('k', l.load);
    c.advance(1_000);
    rc.invalidate();
    // Until OpenSearch has refreshed, the old answer is as good as a new one.
    assert.equal((await rc.get('k', l.load)).outcome, 'hit');
    // An answer stored now may miss the change: fresh only until the change is searchable.
    assert.equal((await rc.get('other', l.load)).outcome, 'miss');
    c.advance(1_500);
    assert.equal((await rc.get('k', l.load)).outcome, 'stale');
    assert.equal((await rc.get('other', l.load)).outcome, 'stale');
    await settled();
    assert.equal((await rc.get('k', l.load)).outcome, 'hit');
    c.advance(14_999);
    assert.equal((await rc.get('k', l.load)).outcome, 'hit', 'refreshed answers get the full TTL');
  });

  it('does not keep an answer from a search that started before a change as fresh', async () => {
    const c = clock();
    const rc = cache(c);
    let release: (v: string) => void = () => undefined;
    const pending = rc.get('k', () => new Promise<string>((r) => (release = r)));
    rc.invalidate();
    c.advance(2_000); // the change is searchable before the old search returns
    release('old');
    assert.equal((await pending).value, 'old');
    assert.equal((await rc.get('k', async () => 'new')).outcome, 'stale');
  });

  it('is off with a TTL of 0', () => {
    assert.equal(cache(clock(), { ttlMs: 0 }).enabled, false);
    assert.equal(cache(clock()).enabled, true);
  });
});

const parse = (q: Record<string, string>) => searchParamsSchema.parse(q) as SearchParams;
const anonymous = { identified: false };

describe('searchCacheKey', () => {
  it('ignores parameter order and an explicit default country', () => {
    const a = searchCacheKey(parse({ category: 'torget', sort: 'newest' }), 'XS', anonymous);
    const b = searchCacheKey(parse({ sort: 'newest', category: 'torget' }), 'XS', anonymous);
    const c = searchCacheKey(
      parse({ sort: 'newest', category: 'torget', country: 'XS' }),
      'XS',
      anonymous,
    );
    assert.ok(a);
    assert.equal(a, b);
    assert.equal(a, c);
  });

  it('tells apart everything that changes the answer', () => {
    const base = searchCacheKey(parse({ q: 'sykkel' }), 'NO', anonymous);
    for (const [params, country] of [
      [{ q: 'Sykkel' }, 'NO'],
      [{ q: 'sykkel' }, 'XS'],
      [{ q: 'sykkel', page: '2' }, 'NO'],
      [{ q: 'sykkel', pageSize: '48' }, 'NO'],
      [{ q: 'sykkel', sort: 'newest' }, 'NO'],
      [{ q: 'sykkel', understand: 'false' }, 'NO'],
      [{ q: 'sykkel', priceMax: '1000' }, 'NO'],
      [{ q: 'sykkel', near: 'bergen', radiusKm: '50' }, 'NO'],
    ] as const) {
      assert.notEqual(
        searchCacheKey(parse(params), country, anonymous),
        base,
        JSON.stringify(params),
      );
    }
  });

  it('is not cached for a signed-in caller or personal parameters', () => {
    assert.equal(searchCacheKey(parse({ q: 'sykkel' }), 'NO', { identified: true }), undefined);
    assert.equal(searchCacheKey(parse({ lat: '60.39', lon: '5.32' }), 'NO', anonymous), undefined);
    assert.equal(
      searchCacheKey(parse({ publishedAfter: '2026-10-01T00:00:00Z' }), 'NO', anonymous),
      undefined,
    );
  });
});

describe('SearchService.searchCached', () => {
  const untouchable = new Proxy({} as SearchIndex, {
    get: () => () => {
      throw new Error('the index was queried');
    },
  });

  /** A service whose search() counts calls instead of asking OpenSearch. */
  function service(rc?: ResultCache<SearchResult>) {
    const svc = new SearchService(
      untouchable,
      imgproxySigner('00'.repeat(32), '11'.repeat(32)),
      'NO',
      false,
      rc,
    );
    let calls = 0;
    svc.search = async () => ({ total: ++calls }) as unknown as SearchResult;
    return { svc, calls: () => calls };
  }
  const rc = () =>
    new ResultCache<SearchResult>({
      ttlMs: 15_000,
      staleMs: 30_000,
      maxEntries: 10,
      settleMs: 1_500,
    });

  it('answers repeated anonymous searches from the cache', async () => {
    const { svc, calls } = service(rc());
    await svc.searchCached(parse({ q: 'sykkel' }), anonymous);
    await svc.searchCached(parse({ q: 'sykkel' }), anonymous);
    assert.equal(calls(), 1);
  });

  it('bypasses the cache for a caller with a token and for personal parameters', async () => {
    const { svc, calls } = service(rc());
    await svc.searchCached(parse({ q: 'sykkel' }), { identified: true });
    await svc.searchCached(parse({ q: 'sykkel' }), { identified: true });
    await svc.searchCached(parse({ lat: '60.39', lon: '5.32' }), anonymous);
    await svc.searchCached(parse({ lat: '60.39', lon: '5.32' }), anonymous);
    assert.equal(calls(), 4);
  });

  it('searches every time without a cache', async () => {
    const { svc, calls } = service();
    await svc.searchCached(parse({ q: 'sykkel' }), anonymous);
    await svc.searchCached(parse({ q: 'sykkel' }), anonymous);
    assert.equal(calls(), 2);
  });
});
