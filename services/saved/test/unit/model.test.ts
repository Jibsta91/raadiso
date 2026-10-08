// Contract test: responses built by the service must satisfy openapi.yaml,
// the same document that generates @raadi/api-client.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { imgproxySigner } from '@raadi/service-kit';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import {
  createSavedSearchSchema,
  toFavourite,
  toSavedSearch,
  updateSavedSearchSchema,
} from '../../src/saved/model.js';

const spec = parse(readFileSync(new URL('../../../openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: 'spec', components: spec.components });
const valid = (name: string, value: unknown) => {
  const validate = ajv.compile({ $ref: `spec#/components/schemas/${name}` });
  assert.ok(validate(value), `${name}: ${JSON.stringify(validate.errors)}`);
};

describe('OpenAPI contract', () => {
  it('Favourite and SavedSearch', () => {
    const fav = toFavourite(
      {
        id: '6f1c4a52-2a43-4d0d-9b55-2f1f1b0e5a11',
        version: 3,
        owner_id: null,
        status: 'sold',
        category: 'bil',
        subcategory: 'personbil',
        title: 'Volvo V60',
        country: 'NO',
        price_minor: '18900000',
        currency: 'NOK',
        image_id: '0d7c1f3e-9a51-4c47-8f0e-1c2b3a4d5e6f',
        place_name: 'Oslo',
        region: 'oslo',
        published_at: new Date('2026-10-01T10:00:00Z'),
        favourited_at: new Date('2026-10-02T10:00:00Z'),
      },
      imgproxySigner('aa'.repeat(32), 'bb'.repeat(32)),
    );
    assert.deepEqual(fav.listing.price, { amountMinor: 18900000, currency: 'NOK' });
    assert.equal(fav.listing.location.regionName, 'Oslo');
    valid('Favourite', fav);
    valid(
      'SavedSearch',
      toSavedSearch({
        id: '0d7c1f3e-9a51-4c47-8f0e-1c2b3a4d5e6f',
        user_id: '3f0c5a6e-1b7d-4c2a-9e51-7a0d2b6c4f11',
        name: 'Elbiler i Oslo',
        params: { category: 'bil', fuel: 'electric', near: 'oslo' },
        notify: true,
        new_count: 4,
        checked_until: new Date(),
        next_run_at: new Date(),
        created_at: new Date('2026-10-01T10:00:00Z'),
      }),
    );
  });
});

describe('saved search input', () => {
  it('keeps only what to find, validated like the search API', () => {
    const s = createSavedSearchSchema.parse({
      name: '  Elbiler ',
      params: { sort: 'price_asc', page: '2', fuel: 'electric', category: 'bil', q: '' },
    });
    assert.equal(s.name, 'Elbiler');
    assert.deepEqual(s.params, { category: 'bil', fuel: 'electric' });
    assert.equal(s.notify, true);
    for (const params of [
      { category: 'boats' },
      { near: 'atlantis' },
      { yearMin: '2020', yearMax: '2010' },
    ])
      assert.ok(
        !createSavedSearchSchema.safeParse({ name: 'x', params }).success,
        JSON.stringify(params),
      );
    assert.ok(!createSavedSearchSchema.safeParse({ name: '', params: {} }).success);
    assert.ok(!updateSavedSearchSchema.safeParse({}).success);
  });
});
