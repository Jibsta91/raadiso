// Reviews and verification against the platform's PostgreSQL image, with a
// fake BankID client. Run: ./raadi test-integration
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { buildEvent, type ListingSnapshot } from '@raadi/events';
import type { Principal } from '@raadi/service-kit';
import type { ReceivedEvent } from '@raadi/service-kit/kafka';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { AppConfig } from '../../src/config.js';
import type { BankIdClient } from '../../src/trust/bankid.js';
import type { ListingsClient } from '../../src/trust/listings.client.js';
import { TrustRepository } from '../../src/trust/trust.repository.js';
import { TrustService } from '../../src/trust/trust.service.js';

let container: StartedTestContainer;
let pool: pg.Pool;
let service: TrustService;

/** Fake provider: the "code" in the callback query is the person's identity. */
const bankid = {
  newRequest: () => ({ state: randomUUID(), nonce: randomUUID(), codeVerifier: randomUUID() }),
  authorizationUrl: async (p: { state: string }) =>
    new URL(`http://bankid.test/authorize?state=${p.state}`),
  complete: async (query: string) => {
    const code = new URLSearchParams(query).get('code');
    if (code === 'bad') throw new Error('invalid_grant');
    return Buffer.from(code ?? '');
  },
} as unknown as BankIdClient;

/** Fake listings internal API: owner and public name per listing. */
const owners = new Map<string, string>();
const listings = {
  seller: async (listingId: string) => {
    const ownerId = owners.get(listingId);
    return ownerId ? { ownerId, sellerName: 'Kari N.' } : null;
  },
} as unknown as ListingsClient;

before(async () => {
  const image = await GenericContainer.fromDockerfile(
    new URL('../../../../../deploy/postgres', import.meta.url).pathname,
  ).build('raadi-postgres-test', { deleteOnExit: false });
  container = await image
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'trust' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: 'postgres',
    password: 'test',
    database: 'trust',
  });
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    await pool.query(sql.split('-- migrate:down')[0]!.replace('-- migrate:up', ''));
  }
  const cfg = {
    env: { REVIEW_WINDOW_DAYS: 30, PUBLIC_BASE_URL: 'http://raadi.localhost' },
  } as unknown as AppConfig;
  service = new TrustService(new TrustRepository(pool), bankid, listings, cfg);
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

const person = (given: string, roles: string[] = ['user']): Principal => ({
  sub: randomUUID(),
  roles,
  scopes: [],
  claims: { given_name: given, family_name: 'Nordmann' },
});

const snapshot = (
  id: string,
  ownerId: string,
  version: number,
  status: ListingSnapshot['status'],
  at = new Date(),
): ListingSnapshot => ({
  id,
  version,
  ownerId,
  status,
  category: 'torget',
  subcategory: 'hobby',
  title: 'Racersykkel',
  description: '',
  priceNok: 4000,
  attributes: {},
  location: { placeId: 'oslo', name: 'Oslo', county: 'oslo', lat: 59.91, lon: 10.75 },
  imageIds: [],
  publishedAt: at.toISOString(),
  updatedAt: at.toISOString(),
});

const listingEvent = (l: ListingSnapshot) =>
  buildEvent(
    l.version === 1
      ? 'no.raadi.listings.listing.published.v1'
      : 'no.raadi.listings.listing.updated.v1',
    { source: 'urn:raadi:listings', subject: l.id, data: { listing: l } },
  );

const message = (listingId: string, senderId: string, recipientId: string) =>
  buildEvent('no.raadi.messaging.conversation.message_sent.v1', {
    source: 'urn:raadi:messaging',
    subject: randomUUID(),
    data: {
      conversationId: randomUUID(),
      messageId: randomUUID(),
      listingId,
      senderId,
      recipientId,
      sentAt: new Date().toISOString(),
    },
  });

/** A listing by `seller` that `buyer` and `seller` talked about, then sold. */
async function deal(seller: Principal, buyer: Principal, soldAt = new Date()) {
  const id = randomUUID();
  owners.set(id, seller.sub);
  await service.onEvent(received(listingEvent(snapshot(id, seller.sub, 1, 'active'))));
  await service.onEvent(received(message(id, buyer.sub, seller.sub)));
  await service.onEvent(received(message(id, seller.sub, buyer.sub)));
  await service.onEvent(received(listingEvent(snapshot(id, seller.sub, 2, 'sold', soldAt))));
  return id;
}

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { getStatus?: () => number }) => e.getStatus?.() ?? 500,
  );

describe('reviews', () => {
  it('lets buyer and seller review each other once after a sale, and publishes events', async () => {
    const seller = person('Kari');
    const buyer = person('Ola');
    const listingId = await deal(seller, buyer);

    const e = await service.eligibility(buyer, listingId, seller.sub);
    assert.equal(e.canReview && e.subjectRole, 'seller');

    const review = await service.createReview(buyer, 'token', {
      listingId,
      subjectId: seller.sub,
      rating: 5,
      comment: 'Rask handel',
    });
    assert.equal(review.reviewer.name, 'Ola N.');
    assert.equal(review.listing.title, 'Racersykkel');
    assert.equal(
      await status(
        service.createReview(buyer, 'token', {
          listingId,
          subjectId: seller.sub,
          rating: 1,
          comment: '',
        }),
      ),
      409,
    );
    await service.createReview(seller, 'token', {
      listingId,
      subjectId: buyer.sub,
      rating: 4,
      comment: '',
    });

    const profile = await service.profile(seller.sub, 20, 0);
    assert.equal(profile.name, 'Kari N.'); // from listings, looked up when the review was written
    assert.deepEqual(profile.rating, { average: 5, count: 1, distribution: [0, 0, 0, 0, 1] });
    assert.equal((await service.sellerOf(listingId)).rating.count, 1);

    const { rows } = await pool.query<{ event_type: string; payload: { data: unknown } }>(
      `SELECT event_type, payload FROM outbox WHERE aggregate_type = 'review' AND aggregate_id = $1`,
      [review.id],
    );
    assert.equal(rows[0]?.event_type, 'no.raadi.trust.review.published.v1');
    assert.deepEqual(Object.keys(rows[0]!.payload.data as object).sort(), [
      'listingId',
      'publishedAt',
      'rating',
      'reviewId',
      'reviewerId',
      'subjectId',
      'subjectRole',
    ]); // no comment text in events
  });

  it('refuses reviews without a sale, a conversation, or within the window', async () => {
    const seller = person('Kari');
    const buyer = person('Ola');
    const stranger = person('Per');
    const id = randomUUID();
    await service.onEvent(received(listingEvent(snapshot(id, seller.sub, 1, 'active'))));
    await service.onEvent(received(message(id, buyer.sub, seller.sub)));
    const reason = async (p: Principal, subject: string) => {
      const e = await service.eligibility(p, id, subject);
      return e.canReview ? 'ok' : e.reason;
    };
    assert.equal(await reason(buyer, seller.sub), 'no_conversation'); // seller never answered
    await service.onEvent(received(message(id, seller.sub, buyer.sub)));
    assert.equal(await reason(buyer, seller.sub), 'not_sold');
    assert.equal(await reason(stranger, seller.sub), 'no_conversation');
    assert.equal(
      await status(
        service.createReview(buyer, 'token', {
          listingId: id,
          subjectId: seller.sub,
          rating: 3,
          comment: '',
        }),
      ),
      422,
    );

    const old = await deal(seller, buyer, new Date(Date.now() - 31 * 86_400_000));
    const e = await service.eligibility(buyer, old, seller.sub);
    assert.equal(!e.canReview && e.reason, 'window_closed');
  });

  it('applies listing events in version order and keeps the sale through deletion', async () => {
    const seller = person('Kari');
    const buyer = person('Ola');
    const id = await deal(seller, buyer);
    // A stale "active" (version 1) arriving late must not undo the sale.
    await service.onEvent(received(listingEvent(snapshot(id, seller.sub, 1, 'active'))));
    assert.equal((await service.eligibility(buyer, id, seller.sub)).canReview, true);
    await service.onEvent(
      received(
        buildEvent('no.raadi.listings.listing.deleted.v1', {
          source: 'urn:raadi:listings',
          subject: id,
          data: { listingId: id, version: 3, imageIds: [] },
        }),
      ),
    );
    assert.equal((await service.eligibility(buyer, id, seller.sub)).canReview, true);

    // Relisting clears the sale.
    const relisted = await deal(seller, buyer);
    await service.onEvent(received(listingEvent(snapshot(relisted, seller.sub, 3, 'active'))));
    const e = await service.eligibility(buyer, relisted, seller.sub);
    assert.equal(!e.canReview && e.reason, 'not_sold');
  });

  it('handles each event once', async () => {
    const seller = person('Kari');
    const event = listingEvent(snapshot(randomUUID(), seller.sub, 1, 'active'));
    await service.onEvent(received(event));
    await service.onEvent(received(event));
    const { rows } = await pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [
      event.id,
    ]);
    assert.equal(rows.length, 1);
  });

  it('lets authors withdraw and moderators remove reviews, without re-reviewing', async () => {
    const seller = person('Kari');
    const buyer = person('Ola');
    const moderator = person('Mona', ['user', 'moderator']);
    const listingId = await deal(seller, buyer);
    const review = await service.createReview(buyer, 'token', {
      listingId,
      subjectId: seller.sub,
      rating: 1,
      comment: 'Uhøflig',
    });
    assert.equal(await status(service.removeReview(seller, review.id)), 403);
    await service.removeReview(buyer, review.id);
    assert.equal((await service.profile(seller.sub, 20, 0)).rating.count, 0);
    assert.equal(
      await status(
        service.createReview(buyer, 'token', {
          listingId,
          subjectId: seller.sub,
          rating: 5,
          comment: '',
        }),
      ),
      409,
    );

    const other = await service.createReview(seller, 'token', {
      listingId,
      subjectId: buyer.sub,
      rating: 2,
      comment: 'Kom ikke',
    });
    await service.removeReview(moderator, other.id);
    const { rows } = await pool.query('SELECT removed_by FROM reviews WHERE id = $1', [other.id]);
    assert.equal(rows[0]?.removed_by, 'moderator');

    // The moderator's removal is audited (ADR-0028); the author's withdrawal is not.
    const audited = await pool.query<{
      aggregate_id: string;
      payload: { data: { action: string; targetId: string; actorRoles: string[] } };
    }>(`SELECT aggregate_id, payload FROM outbox WHERE aggregate_type = 'audit'`);
    const entries = audited.rows.filter((r) => r.payload.data.action === 'review.remove');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.aggregate_id, moderator.sub);
    assert.equal(entries[0]!.payload.data.targetId, other.id);
    assert.deepEqual(entries[0]!.payload.data.actorRoles, ['moderator']);
  });

  it('lets platform admins remove reviews too', async () => {
    const seller = person('Siri');
    const buyer = person('Per');
    const admin = person('Ada', ['user', 'platform-admin']);
    const listingId = await deal(seller, buyer);
    const review = await service.createReview(buyer, 'token', {
      listingId,
      subjectId: seller.sub,
      rating: 1,
      comment: 'Svindel',
    });
    await service.removeReview(admin, review.id);
    const { rows } = await pool.query('SELECT removed_by FROM reviews WHERE id = $1', [review.id]);
    assert.equal(rows[0]?.removed_by, 'moderator');
  });
});

describe('BankID verification', () => {
  const start = async (p: Principal) => {
    const url = new URL(
      await service.startVerification(p, { returnTo: '/en/account', locale: 'en' }),
    );
    return url.searchParams.get('state')!;
  };

  it('verifies the user who started the flow, once per identity', async () => {
    const kari = person('Kari');
    const ola = person('Ola');
    assert.equal(
      await service.completeVerification(kari, `state=${await start(kari)}&code=person-1`),
      '/en/account?verification=ok',
    );
    assert.ok((await service.me(kari)).verification);
    // The same person cannot verify a second account.
    assert.equal(
      await service.completeVerification(ola, `state=${await start(ola)}&code=person-1`),
      '/en/account?verification=taken',
    );
    // A state is bound to the user and can be used once.
    const state = await start(ola);
    assert.equal(
      await service.completeVerification(kari, `state=${state}&code=person-2`),
      '/en/account?verification=failed',
    );
    assert.equal(
      await service.completeVerification(ola, `state=${state}&code=person-2`),
      '/?verification=expired',
    );
    assert.equal(
      await service.completeVerification(ola, `state=${await start(ola)}&error=access_denied`),
      '/en/account?verification=cancelled',
    );
    assert.equal(
      await service.completeVerification(ola, `state=${await start(ola)}&code=bad`),
      '/en/account?verification=failed',
    );

    await service.removeVerification(kari);
    assert.equal((await service.me(kari)).verification, null);
    assert.equal(
      await service.completeVerification(ola, `state=${await start(ola)}&code=person-1`),
      '/en/account?verification=ok',
    );
  });

  it('sends signed-out users to login and back, with safe return paths only', async () => {
    const url = await service.startVerification(undefined, {
      returnTo: '//evil.com',
      locale: 'nb',
    });
    assert.ok(url.startsWith('/auth/login?'));
    const back = new URLSearchParams(url.split('?')[1]).get('returnTo')!;
    assert.equal(back, '/api/v1/trust/verification/start?returnTo=%2Fnb%2Faccount&locale=nb');
  });
});
