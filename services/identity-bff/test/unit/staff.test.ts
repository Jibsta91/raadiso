// The console's user administration (ADR-0030): output matches the OpenAPI contract, and the
// rules about who may act on whom hold before anything reaches Keycloak.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import type { KcUser } from '../../src/staff/keycloak-admin.js';
import { suspendSchema, UserAdminService } from '../../src/staff/users.admin.js';

const spec = parse(readFileSync(new URL('../../../openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: 'spec', components: spec.components });
const validator = (name: string) => ajv.compile({ $ref: `spec#/components/schemas/${name}` });

const KARI = '3f0c5a6e-1b7d-4c2a-9e51-7a0d2b6c4f11';
const MOD = '1a9e3c5b-7d2f-4e8a-b6c1-9f0d4a2e7b44';
const SUPPORT = '9e4f6a8c-0d2b-4f5e-b7a9-4c1d2e6f8b77';

const users: Record<string, KcUser> = {
  [KARI]: {
    id: KARI,
    username: 'kari',
    email: 'kari@raadi.localhost',
    firstName: 'Kari',
    lastName: 'Nordmann',
    enabled: true,
    emailVerified: true,
    createdTimestamp: Date.now(),
  },
  [MOD]: { id: MOD, username: 'mod', email: 'mod@raadi.localhost', enabled: true },
};

function setup() {
  const calls: string[] = [];
  const kc = {
    getUser: async (id: string) => {
      if (!users[id]) throw Object.assign(new Error('404'), { name: 'KeycloakNotFound' });
      return users[id];
    },
    searchUsers: async () => Object.values(users),
    countUsers: async () => 2,
    roleUsers: async (role: string) => (role === 'moderator' ? [users[MOD]] : []),
    sessions: async () => [
      {
        id: 's1',
        ipAddress: '10.0.0.1',
        start: Date.now(),
        lastAccess: Date.now(),
        clients: { a: 'raadi-bff' },
      },
    ],
    credentials: async () => [{ id: 'c1', type: 'password', createdDate: Date.now() }],
    bruteForce: async () => ({ disabled: false, numFailures: 0, lastFailure: 0 }),
    events: async () => [
      { time: Date.now(), type: 'LOGIN', clientId: 'raadi-bff', ipAddress: '10.0.0.1' },
    ],
    setEnabled: async (id: string, enabled: boolean) => void calls.push(`enabled ${id} ${enabled}`),
    signOut: async (id: string) => void calls.push(`signOut ${id}`),
  };
  const query = async (sql: string) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (sql.includes('FROM user_profiles')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  };
  const service = new UserAdminService(pool as never, kc as never);
  return { service, calls };
}

const actor = (sub: string, roles: string[]) => ({ sub, roles, scopes: [], claims: {} });

describe('user administration', () => {
  it('detail and search match the contract', async () => {
    const { service } = setup();
    const detail = await service.detail(KARI);
    const v = validator('AdminUserDetail');
    assert.ok(v(detail), JSON.stringify(v.errors));
    assert.equal(detail.sessions[0]?.clients[0], 'raadi-bff');

    const page = await service.search({ q: '', first: 0, max: 25 });
    const p = validator('AdminUserPage');
    assert.ok(p(page), JSON.stringify(p.errors));
    assert.deepEqual(page.items.find((u) => u.id === MOD)?.staffRoles, ['moderator']);
  });

  it('suspends: records it, audits it, disables the account and ends its sessions', async () => {
    const { service, calls } = setup();
    await service.suspend(actor(SUPPORT, ['support']), KARI, { reasonCode: 'spam', note: '' });
    assert.ok(calls.some((c) => c.startsWith('INSERT INTO user_suspensions')));
    assert.ok(
      calls.some((c) => c.startsWith('INSERT INTO outbox')),
      'audit entry in the outbox',
    );
    assert.ok(calls.includes(`enabled ${KARI} false`));
    assert.ok(calls.includes(`signOut ${KARI}`));
  });

  it('support cannot act on staff, nobody on themselves', async () => {
    const { service, calls } = setup();
    await assert.rejects(
      service.suspend(actor(SUPPORT, ['support']), MOD, { reasonCode: 'spam', note: '' }),
      /Only platform admins act on staff accounts/,
    );
    await assert.rejects(
      service.signOut(actor(KARI, ['platform-admin']), KARI, { note: '' }),
      /your own account/,
    );
    assert.ok(!calls.some((c) => c.startsWith('enabled')), 'Keycloak was not touched');
  });

  it('validates suspension input', () => {
    assert.ok(suspendSchema.safeParse({ reasonCode: 'fraud', hours: 24 }).success);
    assert.ok(!suspendSchema.safeParse({ reasonCode: 'boredom' }).success);
    assert.ok(!suspendSchema.safeParse({ reasonCode: 'fraud', hours: 0 }).success);
  });
});
