import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comparableFilters, rate, unitPrice } from '../../src/search/price.js';
import { compareRuleOf } from '@raadi/catalog';

const stats = { p25: 800, median: 1000, p75: 1300 };

describe('price insight (ADR-0043)', () => {
  it('rates a price against the percentiles, warning about prices far below', () => {
    assert.equal(rate(400, stats), 'unusually_low');
    assert.equal(rate(700, stats), 'great');
    assert.equal(rate(1000, stats), 'good');
    assert.equal(rate(1200, stats), 'fair');
    assert.equal(rate(2000, stats), 'high');
  });

  it('compares property per square metre and livestock per animal', () => {
    assert.equal(unitPrice(100_000, 'areaM2', { areaM2: 50 }), 2000);
    assert.equal(unitPrice(300_000, 'head', { head: 3 }), 100_000);
    assert.equal(unitPrice(300_000, 'head', {}), undefined);
    assert.equal(compareRuleOf('livestock', 'camels').per, 'head');
    assert.equal(compareRuleOf('property', 'land').per, 'areaM2');
  });

  it('matches make and model in lower case, the year within two, and loosens to the subcategory', () => {
    const car = {
      country: 'XS',
      category: 'vehicles',
      subcategory: 'cars',
      attributes: { make: 'Toyota', model: 'Land Cruiser V8', year: 2015 },
    };
    const strict = JSON.stringify(comparableFilters(car, compareRuleOf('vehicles', 'cars'), 0));
    assert.match(strict, /"attributes.make":"toyota"/);
    assert.match(strict, /"attributes.year":\{"gte":2013,"lte":2017\}/);
    const loose = JSON.stringify(comparableFilters(car, compareRuleOf('vehicles', 'cars'), 2));
    assert.doesNotMatch(loose, /make/);
    assert.match(loose, /"subcategory":"cars"/);
  });
});
