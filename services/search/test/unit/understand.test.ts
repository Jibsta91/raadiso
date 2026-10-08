import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { searchParamsSchema } from '../../src/search/query.js';
import { parseAmount, understand } from '../../src/search/understand.js';

const read = (q: string, country: 'XS' | 'NO', extra: Record<string, string> = {}) =>
  understand(searchParamsSchema.parse({ q, ...extra }), country);
const chips = (u: ReturnType<typeof read>) => u.understood.map((x) => x.set);

describe('query understanding (ADR-0041)', () => {
  it('takes a category word as the category, leaving nothing to match as text', () => {
    const u = read('car', 'XS');
    assert.deepEqual(u.params.category, ['vehicles']);
    assert.deepEqual(u.params.subcategory, ['cars']);
    assert.equal(u.text, '');
    assert.deepEqual(chips(u), [{ category: 'vehicles', subcategory: 'cars' }]);
  });

  it('reads a whole query: cheap, a make, a place and a price ceiling', () => {
    const u = read('cheap toyota car hargeisa under 5,000 dollars', 'XS');
    assert.deepEqual(u.params.subcategory, ['cars']);
    assert.equal(u.params.near, 'hargeisa');
    assert.equal(u.params.priceMax, 5000);
    assert.equal(u.params.sort, 'price_asc');
    assert.equal(u.text, 'toyota');
  });

  it('understands Somali words and spellings', () => {
    assert.deepEqual(read('geel', 'XS').params.subcategory, ['camels']);
    assert.deepEqual(read('guri kiro ah burco', 'XS').params.subcategory, ['houses-rent']);
    assert.equal(read('guri kiro ah burco', 'XS').params.near, 'burao');
    assert.deepEqual(read('taleefan jaban', 'XS').params.sort, 'price_asc');
  });

  it('lets a value imply its category: iPhone is a phone of the brand Apple', () => {
    const u = read('iphone 13', 'XS');
    assert.deepEqual(u.params.subcategory, ['mobile-phones']);
    assert.deepEqual(u.params.brand, ['apple']);
    assert.equal(u.text, '13');
  });

  it('prefers the longest phrase: house for rent is a rental, not a sale', () => {
    assert.deepEqual(read('house for rent', 'XS').params.subcategory, ['houses-rent']);
    assert.deepEqual(read('elbil', 'NO').params.subcategory, ['personbil']);
    assert.deepEqual(read('elbil', 'NO').params.fuel, ['electric']);
  });

  it('takes a category over a place of the same name (Ski the sport, not the town)', () => {
    const u = read('ski', 'NO');
    assert.deepEqual(u.params.subcategory, ['sport']);
    assert.equal(u.params.near, undefined);
  });

  it('turns a place into "near" and a region into a region filter', () => {
    assert.equal(read('hargeisa', 'XS').params.near, 'hargeisa');
    assert.equal(read('hargeisa', 'XS').text, '');
    assert.deepEqual(read('sofa togdheer', 'XS').params.region, ['togdheer']);
  });

  it('drops "cheap" and filler words instead of requiring them', () => {
    const u = read('billig sykkel til salgs', 'NO');
    assert.equal(u.params.sort, 'price_asc');
    assert.deepEqual(u.params.subcategory, ['sport']);
    assert.equal(u.text, '');
  });

  it('reads price ranges and bounds in every language', () => {
    assert.equal(read('sofa 100-500', 'XS').params.priceMin, 100);
    assert.equal(read('sofa 100-500', 'XS').params.priceMax, 500);
    assert.equal(read('bil maks 200k', 'NO').params.priceMax, 200000);
    assert.equal(read('geel ilaa 3000', 'XS').params.priceMax, 3000);
    assert.equal(read('phone over 300', 'XS').params.priceMin, 300);
  });

  it('never overrides what the request set itself', () => {
    const u = read('car hargeisa cheap', 'XS', {
      category: 'phones',
      near: 'burao',
      sort: 'newest',
    });
    assert.deepEqual(u.params.category, ['phones']);
    assert.equal(u.params.near, 'burao');
    assert.equal(u.params.sort, 'newest');
    assert.match(u.text, /car/, 'another category’s word stays text inside a chosen category');
    assert.match(u.text, /hargeisa/, 'a second place stays text');
  });

  it('boosts instead of filtering when the query names several categories', () => {
    const u = read('phone laptop', 'XS');
    assert.equal(u.params.category, undefined);
    assert.ok(u.boostCategories.includes('mobile-phones'));
    assert.ok(u.boostValues['attributes.itemType']?.includes('laptop'));
  });

  it('lets a make or model imply its category and still match as text', () => {
    const u = read('Land Cruiser V8', 'XS');
    assert.deepEqual(u.params.subcategory, ['cars']);
    assert.equal(u.text, 'Land Cruiser V8');
    assert.deepEqual(read('volvo', 'NO').params.subcategory, ['personbil']);
  });

  it('keeps words it does not know, in the order typed', () => {
    assert.equal(read('blue velvet 7 seats', 'XS').text, 'blue velvet 7 seats');
    assert.equal(read('', 'XS').text, '');
  });
});

describe('amounts', () => {
  it('reads grouped thousands, decimals and k', () => {
    assert.equal(parseAmount('5,000'), 5000);
    assert.equal(parseAmount('5.000'), 5000);
    assert.equal(parseAmount('12.50'), 12.5);
    assert.equal(parseAmount('2k'), 2000);
    assert.equal(parseAmount('abc'), undefined);
  });
});
