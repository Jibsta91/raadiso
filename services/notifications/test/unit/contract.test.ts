// Contract test: responses built by the service must satisfy openapi.yaml,
// the same document that generates @raadi/api-client.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { redact } from '../../src/notifications/admin.js';
import { toNotification } from '../../src/notifications/model.js';

const spec = parse(readFileSync(new URL('../../../openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: 'spec', components: spec.components });
const valid = (name: string, value: unknown) => {
  const validate = ajv.compile({ $ref: `spec#/components/schemas/${name}` });
  assert.ok(validate(value), `${name}: ${JSON.stringify(validate.errors)}`);
};

describe('OpenAPI contract', () => {
  it('Notification, NotificationList and Preferences', () => {
    const n = toNotification({
      id: '0d7c1f3e-9a51-4c47-8f0e-1c2b3a4d5e6f',
      user_id: '3f0c5a6e-1b7d-4c2a-9e51-7a0d2b6c4f11',
      kind: 'listing_removed',
      ref_id: '6f1c4a52-2a43-4d0d-9b55-2f1f1b0e5a11',
      params: { title: 'Sykkel' },
      created_at: new Date('2026-10-01T10:00:00Z'),
      read_at: null,
    });
    assert.equal(n.link, '/my/listings');
    valid('Notification', n);
    valid('NotificationList', { unread: 1, items: [n] });
    valid('Preferences', { emailMessages: false });
    valid('Preferences', { emailMessages: true, pushMessages: false });
    valid('Device', { token: 'ExponentPushToken[abc]', platform: 'ios' });
  });
});

describe('admin queues (ADR-0030)', () => {
  it('never shows e-mail addresses in provider errors', () => {
    assert.equal(
      redact('550 5.1.1 <kari.nordmann@example.com>: Recipient address rejected'),
      '550 5.1.1 <‹address›>: Recipient address rejected',
    );
  });
});
