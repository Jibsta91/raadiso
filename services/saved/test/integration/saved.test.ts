// Favourites, alerts and the saved-search matcher against the platform's
// PostgreSQL image, with fake listings and search APIs. Run: ./raadi test-integration
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { buildEvent, type ListingSnapshot } from '@raadi/events';
import { imgproxySigner, type Principal } from '@raadi/service-kit';
import type { ReceivedEvent } from '@raadi/service-kit/kafka';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { AppConfig } from '../../src/config.js';
import type { ListingsClient, PublicListing, SearchClient } from '../../src/saved/clients.js';
import { createSavedSearchSchema } from '../../src/saved/model.js';
import { SavedRepository } from '../../src/saved/saved.repository.js';
import { SavedService } from '../../src/saved/saved.service.js';

let container: StartedTestContainer;
let pool: pg.Pool;
let service: SavedService;

/** Fake listings API: what GET /api/v1/listings/{id} returns, per listing (and whether the caller owns it). */
const published = new Map<string, PublicListing>();
const ownerOf = new Map<string, string>();
let listingsDown = false;
const listings = {
  listing: async (id: string, token: string) => {
    if (listingsDown) throw new Error('listings returned 503');
    const l = published.get(id);
    return l ? { ...l, viewer: { isOwner: ownerOf.get(id) === token } } : null;
  },
} as unknown as ListingsClient;

/** Fake search API: matches per saved query (by its q), counted inside the window. */
const searchCalls: Array<{ params: Record<string, string>; after: Date; until: Date }> = [];
let matchesPerCall = 0;
let searchDown = false;
const search = {
  newMatches: async (params: Record<string, string>, after: Date, until: Date) => {
    if (searchDown) throw new Error('search returned 503');
    searchCalls.push({ params, after, until });
    return matchesPerCall;
  },
} as unknown as SearchClient;

const signer = imgproxySigner('aa'.repeat(32), 'bb'.repeat(32));
const user = (): Principal => ({ sub: randomUUID(), roles: ['user'] }) as unknown as Principal;

before(async () => {
  const image = await GenericContainer.fromDockerfile(
    new URL('../../../../../deploy/postgres', import.meta.url).pathname,
  ).build('raadi-postgres-test', { deleteOnExit: false });
  container = await image
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'saved' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: 'postgres',
    password: 'test',
    database: 'saved',
  });
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    await pool.query(sql.split('-- migrate:down')[0]!.replace('-- migrate:up', ''));
  }
  const cfg = {
    env: {
      MAX_FAVOURITES: 3,
      MAX_SAVED_SEARCHES: 2,
      SAVED_SEARCH_INTERVAL_SECONDS: 300,
      SAVED_SEARCH_LAG_SECONDS: 0,
    },
  } as unknown as AppConfig;
  service = new SavedService(new SavedRepository(pool), listings, search, signer, cfg);
});

after(async () => {
  await pool?.end();
  await container?.stop();
});

const received = (value: unknown): ReceivedEvent => ({
  topic: 't',
  partition: 0,
  offset: 0n,
  key: undefined,
  headers: {},
  value,
});

const kroner = (n: number) => ({ amountMinor: n * 100, currency: 'NOK' });

function publish(ownerId: string, priceNok = 1000): PublicListing & { ownerId: string } {
  const id = randomUUID();
  const l = {
    id,
    version: 1,
    status: 'active' as const,
    category: 'torget',
    subcategory: 'sport',
    title: 'Racersykkel',
    country: 'NO',
    price: kroner(priceNok),
    location: { name: 'Bergen', region: 'vestland' },
    images: [{ id: randomUUID() }],
    publishedAt: new Date().toISOString(),
  };
  published.set(id, l);
  ownerOf.set(id, ownerId);
  return { ...l, ownerId };
}

function updated(
  l: { id: string; ownerId: string },
  version: number,
  change: Partial<ListingSnapshot>,
) {
  const snapshot: ListingSnapshot = {
    id: l.id,
    version,
    ownerId: l.ownerId,
    status: 'active',
    category: 'torget',
    subcategory: 'sport',
    title: 'Racersykkel',
    description: 'Lett og rask.',
    priceNok: 1000,
    price: kroner(1000),
    country: 'NO',
    attributes: { condition: 'good' },
    location: {
      placeId: 'bergen',
      name: 'Bergen',
      county: 'vestland',
      region: 'vestland',
      lat: 60.39,
      lon: 5.32,
    },
    imageIds: [],
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...change,
  };
  return buildEvent('no.raadi.listings.listing.updated.v1', {
    source: 'urn:raadi:listings',
    subject: l.id,
    data: { listing: snapshot },
  });
}

const alertsFor = async (userId: string) =>
  (
    await pool.query<{
      payload: {
        data: { kind: string; count?: number; priceNok?: number; price?: { amountMinor: number } };
      };
    }>(
      `SELECT payload FROM outbox WHERE aggregate_type = 'alert' AND aggregate_id = $1 ORDER BY created_at`,
      [userId],
    )
  ).rows.map((r) => r.payload.data);

describe('favourites', () => {
  it('adds, lists (with signed image URLs) and removes favourites, idempotently', async () => {
    const me = user();
    const l = publish(randomUUID());
    await service.addFavourite(me, 'token-me', l.id);
    await service.addFavourite(me, 'token-me', l.id);
    const page = await service.favourites(me, 10, 0);
    assert.equal(page.total, 1);
    assert.equal(page.items[0]!.listing.title, 'Racersykkel');
    assert.equal(page.items[0]!.listing.location.regionName, 'Vestland');
    assert.match(page.items[0]!.listing.image!.card, /^\/img\//);
    assert.deepEqual((await service.favouriteIds(me)).ids, [l.id]);
    await service.removeFavourite(me, l.id);
    await service.removeFavourite(me, l.id);
    assert.equal((await service.favourites(me, 10, 0)).total, 0);
    // Nobody's favourite any more: the projection is gone too.
    const left = await pool.query('SELECT 1 FROM listings WHERE id = $1', [l.id]);
    assert.equal(left.rowCount, 0);
  });

  it('refuses own listings, unknown listings and more than the limit; reports outages', async () => {
    const me = user();
    const mine = publish(me.sub);
    await assert.rejects(service.addFavourite(me, me.sub, mine.id), /own listing/);
    await assert.rejects(service.addFavourite(me, 't', randomUUID()), /not found/);
    for (let i = 0; i < 3; i++) await service.addFavourite(me, 't', publish(randomUUID()).id);
    await assert.rejects(service.addFavourite(me, 't', publish(randomUUID()).id), /limit/);
    listingsDown = true;
    await assert.rejects(
      service.addFavourite(user(), 't', publish(randomUUID()).id),
      /unavailable/,
    );
    listingsDown = false;
  });

  it('alerts fans (not the owner) when a favourite gets cheaper or is sold, once per event', async () => {
    const seller = randomUUID();
    const fan = user();
    const l = publish(seller, 1000);
    await service.addFavourite(fan, 't', l.id);

    const cheaper = updated(l, 2, { priceNok: 800, price: kroner(800) });
    await service.onEvent(received(cheaper));
    await service.onEvent(received(cheaper)); // redelivery
    // An event from before ADR-0040 (kroner only): price up, no alert.
    await service.onEvent(received(updated(l, 3, { priceNok: 900, price: undefined })));
    await service.onEvent(received(updated(l, 2, { priceNok: 1, price: kroner(1) }))); // stale
    await service.onEvent(
      received(updated(l, 4, { priceNok: 900, price: kroner(900), status: 'sold' })),
    );

    const alerts = await alertsFor(fan.sub);
    assert.deepEqual(
      alerts.map((a) => a.kind),
      ['price_drop', 'sold'],
    );
    assert.equal(alerts[0]!.price?.amountMinor, 80000);
    assert.equal(alerts[0]!.priceNok, 800, 'kroner too, for consumers that predate ADR-0040');
    assert.equal((await alertsFor(seller)).length, 0);
    // Sold favourites stay on the list, marked sold.
    const page = await service.favourites(fan, 10, 0);
    assert.equal(page.items[0]!.listing.status, 'sold');
    assert.deepEqual(page.items[0]!.listing.price, kroner(900));
  });

  it('ignores events for listings nobody has as a favourite, and hides deleted ones', async () => {
    const stranger = publish(randomUUID());
    await service.onEvent(received(updated(stranger, 2, { priceNok: 1, price: kroner(1) })));
    assert.equal(
      (await pool.query('SELECT 1 FROM listings WHERE id = $1', [stranger.id])).rowCount,
      0,
    );

    const fan = user();
    const l = publish(randomUUID());
    await service.addFavourite(fan, 't', l.id);
    await service.onEvent(
      received(
        buildEvent('no.raadi.listings.listing.deleted.v1', {
          source: 'urn:raadi:listings',
          subject: l.id,
          data: { listingId: l.id, version: 2, imageIds: [] },
        }),
      ),
    );
    assert.equal((await service.favourites(fan, 10, 0)).total, 0);
  });
});

describe('saved searches', () => {
  const input = (q: string, extra: Record<string, string> = {}) =>
    createSavedSearchSchema.parse({ name: q, params: { q, page: '3', sort: 'newest', ...extra } });

  it('normalises queries, saves each once, and enforces the limit', async () => {
    const me = user();
    const a = await service.saveSearch(me, input('sykkel', { category: 'torget' }));
    assert.equal(a.created, true);
    assert.deepEqual(a.search.params, { category: 'torget', q: 'sykkel' });
    const again = await service.saveSearch(me, input('sykkel', { category: 'torget' }));
    assert.equal(again.created, false);
    assert.equal(again.search.id, a.search.id);
    await service.saveSearch(me, input('ski'));
    await assert.rejects(service.saveSearch(me, input('telt')), /limit/);
    assert.throws(() =>
      createSavedSearchSchema.parse({ name: 'x', params: { category: 'boats' } }),
    );
  });

  it('alerts on new matches in the window, counts them until seen, and skips muted searches', async () => {
    const me = user();
    const { search: s } = await service.saveSearch(me, input('kajakk'));
    const muted = (await service.saveSearch(me, input('ski-muted'))).search;
    await service.updateSearch(me, muted.id, { notify: false });
    await pool.query("UPDATE saved_searches SET checked_until = now() - interval '10 minutes'");

    matchesPerCall = 2;
    searchCalls.length = 0;
    await service.checkDueSearches();
    assert.equal(searchCalls.filter((c) => c.params.q === 'ski-muted').length, 0);
    const call = searchCalls.find((c) => c.params.q === 'kajakk');
    assert.ok(call && call.until > call.after);

    let [row] = (await service.savedSearches(me)).items.filter((x) => x.id === s.id);
    assert.equal(row!.newCount, 2);
    const alerts = await alertsFor(me.sub);
    assert.deepEqual(alerts.at(-1), {
      ...alerts.at(-1),
      kind: 'search_match',
      count: 2,
    });

    // Not due again until the interval passes; then the next window starts where this one ended.
    searchCalls.length = 0;
    await service.checkDueSearches();
    assert.equal(searchCalls.length, 0);
    await pool.query('UPDATE saved_searches SET next_run_at = now() WHERE id = $1', [s.id]);
    matchesPerCall = 0;
    await service.checkDueSearches();
    assert.equal(searchCalls[0]!.after.getTime(), call!.until.getTime());

    await service.markSeen(me, s.id);
    [row] = (await service.savedSearches(me)).items.filter((x) => x.id === s.id);
    assert.equal(row!.newCount, 0);
  });

  it('retries the same window after a failed check, and deletes only own searches', async () => {
    const me = user();
    const { search: s } = await service.saveSearch(me, input('telt'));
    const before = (
      await pool.query('SELECT checked_until FROM saved_searches WHERE id = $1', [s.id])
    ).rows[0].checked_until as Date;
    await pool.query('UPDATE saved_searches SET next_run_at = now() WHERE id = $1', [s.id]);
    searchDown = true;
    await service.checkDueSearches();
    searchDown = false;
    const afterFail = (
      await pool.query('SELECT checked_until FROM saved_searches WHERE id = $1', [s.id])
    ).rows[0].checked_until as Date;
    assert.equal(afterFail.getTime(), before.getTime());

    await assert.rejects(service.deleteSearch(user(), s.id), /not found/);
    await service.deleteSearch(me, s.id);
    assert.equal((await service.savedSearches(me)).items.length, 0);
  });
});
