// Which images a listing has, kept in sync from listing events, against the platform's PostgreSQL image.
// Run: ./raadi test-integration
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { pruneEventTables } from '@raadi/service-kit';
import { MediaRepository } from '../../src/media/media.repository.js';

let container: StartedTestContainer;
let pool: pg.Pool;
let repo: MediaRepository;

before(async () => {
  const image = await GenericContainer.fromDockerfile(
    new URL('../../../../../deploy/postgres', import.meta.url).pathname,
  ).build('raadi-postgres-test', { deleteOnExit: false });
  container = await image
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'media' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: 'postgres',
    password: 'test',
    database: 'media',
  });
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    await pool.query(sql.split('-- migrate:down')[0]!.replace('-- migrate:up', ''));
  }
  repo = new MediaRepository(pool);
});

after(async () => {
  await pool?.end();
  await container?.stop();
});

async function image(ownerId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO media (id, owner_id, status, content_type, bytes, sha256)
     VALUES ($1, $2, 'ready', 'image/jpeg', 10, 'x')`,
    [id, ownerId],
  );
  return id;
}

const attachedTo = async (id: string) =>
  (
    await pool.query<{ listing_id: string | null }>('SELECT listing_id FROM media WHERE id = $1', [
      id,
    ])
  ).rows[0]!.listing_id;

describe('listing events', () => {
  it('apply once, and an older version never undoes a newer one', async () => {
    const owner = randomUUID();
    const listing = randomUUID();
    const [a, b] = [await image(owner), await image(owner)];

    // Version 2 says the listing has image b only.
    assert.equal(
      await repo.syncListingImages(randomUUID(), listing, 2, { ownerId: owner, imageIds: [b] }),
      true,
    );
    // Version 1 (late, redelivered or replayed from the dead-letter topic) had image a: ignored.
    assert.equal(
      await repo.syncListingImages(randomUUID(), listing, 1, { ownerId: owner, imageIds: [a] }),
      false,
    );
    assert.equal(await attachedTo(a), null);
    assert.equal(await attachedTo(b), listing);

    // The same event twice: applied once.
    const event = randomUUID();
    assert.equal(await repo.syncListingImages(event, listing, 3, null), true);
    assert.equal(await repo.syncListingImages(event, listing, 3, null), false);
    assert.equal(await attachedTo(b), null);
  });

  it('only attaches the owner’s own images', async () => {
    const listing = randomUUID();
    const mine = await image(randomUUID());
    await repo.syncListingImages(randomUUID(), listing, 1, {
      ownerId: randomUUID(),
      imageIds: [mine],
    });
    assert.equal(await attachedTo(mine), null);
  });
});

describe('event table janitor', () => {
  it('deletes outbox rows after 7 days and processed events after 30, and keeps newer ones', async () => {
    const outbox = (days: number) =>
      pool.query(
        `INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, created_at)
         VALUES ($1, 'media', $3, 't', '{}', now() - make_interval(days => $2::int))`,
        [randomUUID(), days, randomUUID()],
      );
    const processed = (days: number) =>
      pool.query(
        `INSERT INTO processed_events (event_id, processed_at)
         VALUES ($1, now() - make_interval(days => $2::int))`,
        [randomUUID(), days],
      );
    await pool.query('DELETE FROM outbox');
    await pool.query('DELETE FROM processed_events');
    await Promise.all([outbox(8), outbox(1), processed(31), processed(8)]);

    assert.deepEqual(await pruneEventTables(pool), { outbox: 1, processed_events: 1 });
    const count = async (table: string) =>
      Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);
    assert.equal(await count('outbox'), 1);
    assert.equal(await count('processed_events'), 1);
  });
});
