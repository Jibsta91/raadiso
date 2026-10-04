// The audit log against the platform's PostgreSQL image. Run: ./raadi test-integration
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { buildEvent } from '@raadi/events';
import type { ReceivedEvent } from '@raadi/service-kit/kafka';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { AuditService } from '../../src/audit/audit.js';

let container: StartedTestContainer;
let pool: pg.Pool;
let service: AuditService;

before(async () => {
  const image = await GenericContainer.fromDockerfile(
    new URL('../../../../../deploy/postgres', import.meta.url).pathname,
  ).build('raadi-postgres-test', { deleteOnExit: false });
  container = await image
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'audit' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: 'postgres',
    password: 'test',
    database: 'audit',
  });
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    await pool.query(sql.split('-- migrate:down')[0]!.replace('-- migrate:up', ''));
  }
  service = new AuditService(pool);
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
const action = (actorId: string, act: string, targetId: string, at: Date) =>
  buildEvent('no.raadi.audit.action.v1', {
    source: 'urn:raadi:listings',
    subject: actorId,
    data: {
      actionId: randomUUID(),
      actorId,
      actorRoles: ['moderator'],
      action: act,
      targetType: 'listing',
      targetId,
      at: at.toISOString(),
    },
  });

describe('audit log', () => {
  it('records each action once and answers filtered, paged queries', async () => {
    const mod = randomUUID();
    const listing = randomUUID();
    const first = action(mod, 'listing.remove', listing, new Date('2026-10-04T09:00:00Z'));
    await service.onEvent(received(first));
    await service.onEvent(received(first)); // redelivery
    await service.onEvent(
      received(action(mod, 'reports.dismiss', randomUUID(), new Date('2026-10-04T10:00:00Z'))),
    );

    const mine = await service.query({ actor: mod, limit: 1 });
    assert.equal(mine.items[0]!.action, 'reports.dismiss', 'newest first');
    assert.equal(mine.hasMore, true);
    const older = await service.query({ actor: mod, before: mine.items[0]!.at, limit: 50 });
    assert.deepEqual(
      older.items.map((e) => e.action),
      ['listing.remove'],
    );
    const byTarget = await service.query({ targetType: 'listing', targetId: listing, limit: 50 });
    assert.equal(byTarget.items.length, 1);
    assert.equal(byTarget.items[0]!.source, 'urn:raadi:listings');
  });

  it('is append-only: entries cannot be changed or deleted', async () => {
    await assert.rejects(pool.query("UPDATE audit_entries SET action = 'tampered'"), /append-only/);
    await assert.rejects(pool.query('DELETE FROM audit_entries'), /append-only/);
    await assert.rejects(pool.query('TRUNCATE audit_entries'), /append-only/);
  });
});
