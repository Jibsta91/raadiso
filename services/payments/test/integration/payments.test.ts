// Orders, webhooks, reconciliation and refunds against the platform's
// PostgreSQL image, with a fake provider and listings. Run: ./raadi test-integration
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Principal } from '@raadi/service-kit';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { AppConfig } from '../../src/config.js';
import type { ListingFacts, ListingsClient } from '../../src/payments/listings.client.js';
import type { ProviderOutcome } from '../../src/payments/model.js';
import { PaymentsRepository } from '../../src/payments/payments.repository.js';
import { PaymentsService } from '../../src/payments/payments.service.js';
import {
  type IncomingWebhook,
  type PaymentProvider,
  type ProviderStatus,
  WebhookRejected,
} from '../../src/payments/providers/provider.js';

let container: StartedTestContainer;
let pool: pg.Pool;
let service: PaymentsService;

/** In-memory provider: state per reference; webhooks are JSON with a fixed signature header. */
class FakeProvider implements PaymentProvider {
  readonly name = 'vipps' as const;
  readonly autoCapture = false;
  state = new Map<string, ProviderStatus['outcome']>();
  captures: string[] = [];
  down = false;
  async create(i: { reference: string }) {
    if (this.down) throw new Error('provider down');
    this.state.set(i.reference, 'pending');
    return { providerRef: i.reference, redirectUrl: `http://pay.test/pay/${i.reference}` };
  }
  async status(ref: string): Promise<ProviderStatus> {
    return { outcome: this.state.get(ref) ?? 'failed', authorizedOre: 0, capturedOre: 0 };
  }
  async capture(ref: string, _amount: number, key: string) {
    this.captures.push(key);
    this.state.set(ref, 'captured');
  }
  async refund(ref: string) {
    this.state.set(ref, 'refunded');
  }
  async cancel(ref: string) {
    this.state.set(ref, 'cancelled');
  }
  verifyWebhook(req: IncomingWebhook) {
    if (req.headers['x-test-sig'] !== 'ok') throw new WebhookRejected('bad signature');
    return JSON.parse(req.rawBody.toString()) as {
      eventId: string;
      reference: string;
      outcome: ProviderOutcome;
    };
  }
}
const provider = new FakeProvider();

const listingsById = new Map<string, ListingFacts>();
const listings = {
  facts: async (id: string) => {
    const l = listingsById.get(id);
    if (!l) throw Object.assign(new Error('not found'), { getStatus: () => 404 });
    return l;
  },
} as unknown as ListingsClient;

const person = (roles = ['user']): Principal => ({
  sub: randomUUID(),
  roles,
  scopes: [],
  claims: {},
});
const listingOf = (owner: Principal, status: 'active' | 'sold' = 'active') => {
  const id = randomUUID();
  listingsById.set(id, { listingId: id, ownerId: owner.sub, title: 'Sykkel', status });
  return id;
};
const webhook = (reference: string, outcome: ProviderOutcome, eventId = randomUUID()) =>
  service.webhook('vipps', {
    path: '/api/v1/payments/webhooks/vipps',
    host: 'payments:4000',
    headers: { 'x-test-sig': 'ok' },
    rawBody: Buffer.from(JSON.stringify({ eventId, reference, outcome })),
  });
const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { getStatus?: () => number }) => e.getStatus?.() ?? 500,
  );

before(async () => {
  const image = await GenericContainer.fromDockerfile(
    new URL('../../../../../deploy/postgres', import.meta.url).pathname,
  ).build('raadi-postgres-test', { deleteOnExit: false });
  container = await image
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'payments' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: 'postgres',
    password: 'test',
    database: 'payments',
  });
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    await pool.query(sql.split('-- migrate:down')[0]!.replace('-- migrate:up', ''));
  }
  const cfg = {
    env: { PUBLIC_BASE_URL: 'http://raadi.localhost', RECONCILE_AFTER_SECONDS: 0 },
  } as unknown as AppConfig;
  service = new PaymentsService(new PaymentsRepository(pool), listings, provider, cfg);
});

after(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(() => {
  provider.down = false;
});

const events = async (aggregateId: string) =>
  (
    await pool.query<{ event_type: string; payload: { data: Record<string, unknown> } }>(
      'SELECT event_type, payload FROM outbox WHERE aggregate_id = $1 ORDER BY created_at',
      [aggregateId],
    )
  ).rows;

describe('orders', () => {
  it('are idempotent per key; reusing a key for another request is a conflict', async () => {
    const seller = person();
    const listingId = listingOf(seller);
    const a = await service.createOrder(seller, 't', 'key-00000001', {
      listingId,
      product: 'promote_7d',
      locale: 'en',
    });
    assert.equal(a.created, true);
    assert.equal(a.order.redirectUrl, `http://pay.test/pay/${a.order.id}`);
    assert.equal(a.order.amountOre, 4900);
    const b = await service.createOrder(seller, 't', 'key-00000001', {
      listingId,
      product: 'promote_7d',
      locale: 'en',
    });
    assert.deepEqual([b.created, b.order.id], [false, a.order.id]);
    assert.equal(
      await status(
        service.createOrder(seller, 't', 'key-00000001', {
          listingId,
          product: 'promote_30d',
          locale: 'en',
        }),
      ),
      409,
    );
  });

  it('are only for the seller of an active listing', async () => {
    const seller = person();
    const stranger = person();
    assert.equal(
      await status(
        service.createOrder(stranger, 't', 'key-00000002', {
          listingId: listingOf(seller),
          product: 'promote_7d',
          locale: 'nb',
        }),
      ),
      403,
    );
    assert.equal(
      await status(
        service.createOrder(seller, 't', 'key-00000003', {
          listingId: listingOf(seller, 'sold'),
          product: 'promote_7d',
          locale: 'nb',
        }),
      ),
      409,
    );
  });

  it('fail cleanly when the provider is down', async () => {
    const seller = person();
    provider.down = true;
    assert.equal(
      await status(
        service.createOrder(seller, 't', 'key-00000004', {
          listingId: listingOf(seller),
          product: 'promote_7d',
          locale: 'nb',
        }),
      ),
      503,
    );
    const { rows } = await pool.query('SELECT status FROM orders WHERE user_id = $1', [seller.sub]);
    assert.equal(rows[0]?.status, 'failed');
  });
});

describe('webhooks and reconciliation', () => {
  it('capture after authorization, activate the promotion and publish events once', async () => {
    const seller = person();
    const listingId = listingOf(seller);
    const { order } = await service.createOrder(seller, 't', 'key-00000005', {
      listingId,
      product: 'promote_7d',
      locale: 'en',
    });
    const eventId = randomUUID();
    await webhook(order.id, 'authorized', eventId);
    await webhook(order.id, 'authorized', eventId); // duplicate delivery
    await webhook(order.id, 'captured'); // the provider's own capture notice
    assert.deepEqual(
      provider.captures.filter((k) => k === `capture-${order.id}`),
      [`capture-${order.id}`],
    );
    const view = await service.getOrder(seller, order.id);
    assert.equal(view.status, 'captured');
    assert.ok(view.promotedUntil);
    assert.deepEqual(
      (await events(order.id)).map((e) => e.event_type),
      ['no.raadi.payments.payment.captured.v1'],
    );
    const promo = await events(listingId);
    assert.equal(promo.length, 1);
    assert.equal(promo[0]!.payload.data.reason, 'purchased');
    assert.equal(
      await status(
        service.webhook('vipps', {
          path: '/x',
          host: 'h',
          headers: { 'x-test-sig': 'forged' },
          rawBody: Buffer.from('{}'),
        }),
      ),
      401,
    );
  });

  it('recover orders whose webhook was lost', async () => {
    const seller = person();
    const { order } = await service.createOrder(seller, 't', 'key-00000006', {
      listingId: listingOf(seller),
      product: 'promote_30d',
      locale: 'en',
    });
    provider.state.set(order.id, 'authorized'); // approved, but no webhook arrives
    await pool.query("UPDATE orders SET updated_at = now() - interval '5 minutes' WHERE id = $1", [
      order.id,
    ]);
    assert.ok((await service.reconcile()) >= 1);
    assert.equal((await service.getOrder(seller, order.id)).status, 'captured');
  });

  it('stack promotions, and refunds revoke them (admins only)', async () => {
    const seller = person();
    // Real realm roles: a moderator may not refund, a platform admin may.
    const moderator = person(['user', 'moderator']);
    const admin = person(['user', 'moderator', 'platform-admin']);
    const listingId = listingOf(seller);
    const first = (
      await service.createOrder(seller, 't', 'key-00000007', {
        listingId,
        product: 'promote_7d',
        locale: 'en',
      })
    ).order;
    await webhook(first.id, 'authorized');
    const second = (
      await service.createOrder(seller, 't', 'key-00000008', {
        listingId,
        product: 'promote_7d',
        locale: 'en',
      })
    ).order;
    await webhook(second.id, 'authorized');
    const ends = (
      await pool.query<{ starts_at: Date; ends_at: Date }>(
        'SELECT starts_at, ends_at FROM promotions WHERE listing_id = $1 ORDER BY ends_at',
        [listingId],
      )
    ).rows;
    assert.equal(
      ends[1]!.starts_at.getTime(),
      ends[0]!.ends_at.getTime(),
      'the second starts when the first ends',
    );

    assert.equal(await status(service.refund(seller, second.id)), 403);
    assert.equal(await status(service.refund(moderator, second.id)), 403);
    const refunded = await service.refund(admin, second.id);
    assert.equal(refunded.status, 'refunded');
    const promo = await events(listingId);
    const last = promo.at(-1)!.payload.data;
    assert.equal(last.reason, 'refunded');
    assert.equal(
      last.promotedUntil,
      ends[0]!.ends_at.toISOString(),
      'the first promotion keeps running',
    );
  });
});
