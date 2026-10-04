// Contract test: entries built by the service must satisfy openapi.yaml.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { querySchema, toEntry } from '../../src/audit/audit.js';

const spec = parse(readFileSync(new URL('../../../openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: 'spec', components: spec.components });

describe('audit', () => {
  it('entries match the contract', () => {
    const validate = ajv.compile({ $ref: 'spec#/components/schemas/AuditEntry' });
    const entry = toEntry({
      action_id: '0d7c1f3e-9a51-4c47-8f0e-1c2b3a4d5e6f',
      actor_id: '5e7b9d1f-3a4c-4b6e-9d2a-0c8f6e1b3d55',
      actor_roles: ['moderator', 'platform-admin'],
      action: 'payment.refund',
      target_type: 'order',
      target_id: '6f1c4a52-2a43-4d0d-9b55-2f1f1b0e5a11',
      reason: null,
      source: 'urn:raadi:payments',
      at: new Date('2026-10-04T10:00:00Z'),
    });
    assert.ok(validate(entry), JSON.stringify(validate.errors));
  });

  it('accepts only known filters', () => {
    assert.equal(querySchema.parse({}).limit, 50);
    assert.ok(!querySchema.safeParse({ actor: 'not-a-uuid' }).success);
    assert.ok(!querySchema.safeParse({ drop: 'table' }).success);
  });
});
