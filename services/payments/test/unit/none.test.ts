// PAYMENTS_PROVIDER=none (ADR-0051): no products, no new orders, and the answer still fits the spec.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import type { AppConfig } from '../../src/config.js';
import type { ListingsClient } from '../../src/payments/listings.client.js';
import type { PaymentsRepository } from '../../src/payments/payments.repository.js';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { NoProvider } from '../../src/payments/providers/none.js';

const spec = parse(readFileSync(new URL('../../../openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: 'spec', components: spec.components });

// Dependencies that fail on use: with no provider, nothing may reach the database or listings.
const untouchable = <T extends object>() =>
  new Proxy({} as T, {
    get: () => () => {
      throw new Error('used');
    },
  });
const service = new PaymentsService(
  untouchable<PaymentsRepository>(),
  untouchable<ListingsClient>(),
  new NoProvider(),
  {} as AppConfig,
);

describe('no payment provider (ADR-0051)', () => {
  it('lists no products and says so', () => {
    const list = service.products();
    assert.deepEqual(list, { items: [], provider: 'none' });
    const validate = ajv.compile({ $ref: 'spec#/components/schemas/ProductList' });
    assert.ok(validate(list), JSON.stringify(validate.errors));
  });
  it('refuses new orders with 503, before touching anything', async () => {
    await assert.rejects(
      service.createOrder(
        { sub: '3f0c5a6e-1b7d-4c2a-9e51-7a0d2b6c4f11' } as never,
        'token',
        'abcdefgh',
        { listingId: '6f1c4a52-2a43-4d0d-9b55-2f1f1b0e5a11', product: 'promote_7d' } as never,
      ),
      ServiceUnavailableException,
    );
  });
});
