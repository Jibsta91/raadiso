import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imgproxySigner } from '@raadi/service-kit';
import { envSchema } from '../../src/config.js';
import type { SearchIndex } from '../../src/search/search.index.js';
import { SearchService } from '../../src/search/search.service.js';

// An index that fails on use: with price insight off, nothing may ask it for comparables.
const untouchable = new Proxy({} as SearchIndex, {
  get: () => () => {
    throw new Error('the index was queried');
  },
});
const off = new SearchService(
  untouchable,
  imgproxySigner('00'.repeat(32), '11'.repeat(32)),
  'NO',
  false,
);

describe('price insight switch (ADR-0050)', () => {
  it('is off unless PRICE_INSIGHT=true', () => {
    const flag = envSchema.shape.PRICE_INSIGHT;
    assert.equal(flag.parse(undefined), false);
    assert.equal(flag.parse('false'), false);
    assert.equal(flag.parse('true'), true);
  });
  it('answers no insight and no guide when off, without querying the index', async () => {
    assert.equal(await off.priceInsight('6a2e031f-7382-4c4d-a603-d38b4b34a025'), null);
    assert.equal(
      await off.priceGuide({
        country: 'NO',
        category: 'bil',
        subcategory: 'personbil',
        attributes: {},
      }),
      null,
    );
  });
});
