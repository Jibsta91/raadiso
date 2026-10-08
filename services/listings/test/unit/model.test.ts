import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createListingSchema,
  mergedListingSchema,
  updateListingSchema,
} from '../../src/listings/listing.model.js';

const valid = {
  category: 'torget',
  subcategory: 'sport',
  title: 'Langrennsski',
  description: 'Lite brukt',
  price: { amountMinor: 150000, currency: 'NOK' },
  attributes: { condition: 'good' },
  placeId: 'oslo',
};

const issues = (input: unknown) => {
  const r = createListingSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('listing validation', () => {
  it('accepts a valid listing and defaults images to none', () => {
    const r = createListingSchema.parse(valid);
    assert.deepEqual(r.imageIds, []);
  });

  it('checks the subcategory belongs to the category', () => {
    assert.deepEqual(issues({ ...valid, subcategory: 'personbil' }), ['subcategory']);
  });

  it('validates category-specific attributes', () => {
    assert.deepEqual(issues({ ...valid, attributes: { condition: 'broken' } }), [
      'attributes.condition',
    ]);
    assert.deepEqual(issues({ ...valid, attributes: { condition: 'good', colour: 'red' } }), [
      'attributes',
    ]);
  });

  it('follows the category’s price rule: required, none for jobs, optional for services', () => {
    assert.deepEqual(issues({ ...valid, price: null }), ['price']);
    const job = {
      ...valid,
      category: 'jobb',
      subcategory: 'it',
      attributes: { employer: 'Nordlys AS', employmentType: 'full_time' },
    };
    assert.deepEqual(issues({ ...job, price: { amountMinor: 60000000, currency: 'NOK' } }), [
      'price',
    ]);
    assert.deepEqual(issues({ ...job, price: null }), []);
    const tutor = {
      ...valid,
      category: 'services',
      subcategory: 'tutoring',
      attributes: {},
      placeId: 'hargeisa',
    };
    assert.deepEqual(issues({ ...tutor, price: null }), []);
    assert.deepEqual(issues({ ...tutor, price: { amountMinor: 1500, currency: 'USD' } }), []);
  });

  it('takes the country from the place: its taxonomy and its currency (ADR-0040)', () => {
    const phone = {
      category: 'phones',
      subcategory: 'mobile-phones',
      title: 'Samsung Galaxy A54',
      description: 'Like new',
      price: { amountMinor: 24000, currency: 'USD' },
      attributes: { condition: 'like_new', brand: 'samsung', storageGb: 128 },
      placeId: 'hargeisa',
    };
    assert.deepEqual(issues(phone), []);
    assert.deepEqual(issues({ ...phone, price: { amountMinor: 24000, currency: 'NOK' } }), [
      'price.currency',
    ]);
    assert.deepEqual(issues({ ...phone, placeId: 'oslo' }), ['category', 'price.currency']);
    assert.deepEqual(issues({ ...valid, placeId: 'burao' }), ['category', 'price.currency']);
    assert.deepEqual(issues({ ...phone, attributes: { condition: 'like_new' } }), [
      'attributes.brand',
    ]);
  });

  it('rejects unknown places, duplicate images and unknown fields', () => {
    assert.deepEqual(issues({ ...valid, placeId: 'atlantis' }), ['placeId']);
    const id = '3f0c5a6e-1b7d-4c2a-9e51-7a0d2b6c4f11';
    assert.deepEqual(issues({ ...valid, imageIds: [id, id] }), ['imageIds']);
    assert.deepEqual(issues({ ...valid, ownerId: id }), ['']);
  });

  it('PATCH accepts partial bodies, and the merged result is validated as a whole', () => {
    assert.ok(updateListingSchema.safeParse({ status: 'sold' }).success);
    assert.ok(!updateListingSchema.safeParse({}).success);
    assert.ok(!updateListingSchema.safeParse({ status: 'deleted' }).success);
    const merged = mergedListingSchema.safeParse({ ...valid, imageIds: [], category: 'bil' });
    assert.ok(!merged.success, 'switching category without matching attributes fails');
  });
});
