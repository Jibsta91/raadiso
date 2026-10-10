// Message keys the code asks for must exist in every language: a missing one shows its raw key on the
// page (search.facets.region did). Literal keys are checked exactly, template keys by their prefix, and
// the keys the search page builds from the taxonomy (facets, ranges) for every category.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { categoriesOf, facetsOf, rangesOf, subcategoriesOf } from '@raadi/catalog/categories';
import { COUNTRY_CODES } from '@raadi/catalog/countries';
import { ALL_USES, at, loadMessages, rel } from './i18n-usage.ts';

const LOCALES = ['en', 'so', 'nb'];

describe('message keys used in code', () => {
  it('finds the translator calls (sanity check of the scanner)', () => {
    assert.ok(ALL_USES.filter((u) => u.exact).length > 500);
    assert.ok(ALL_USES.some((u) => u.path === 'search.facets' && !u.exact));
  });

  for (const locale of LOCALES) {
    const messages = loadMessages(locale);
    it(`${locale} has every literal key`, () => {
      const missing = ALL_USES.filter(
        (u) => u.exact && !u.optional && typeof at(messages, u.path) !== 'string',
      ).map((u) => `${rel(u.file)}:${u.line}: ${u.path}`);
      assert.deepEqual(missing, []);
    });
    it(`${locale} has every template prefix`, () => {
      const missing = ALL_USES.filter(
        (u) => !u.exact && u.path && typeof at(messages, u.path) !== 'object',
      ).map((u) => `${rel(u.file)}:${u.line}: ${u.path}.*`);
      assert.deepEqual(missing, []);
    });
    it(`${locale} names every search facet and range of every category`, () => {
      const facets = new Set(['category', 'subcategory', 'region']);
      const ranges = new Set<string>();
      for (const country of COUNTRY_CODES)
        for (const { id } of categoriesOf(country))
          for (const sub of [undefined, ...subcategoriesOf(id)]) {
            for (const f of facetsOf(id, sub)) facets.add(f.key);
            for (const r of rangesOf(id, sub)) ranges.add(r.param);
          }
      const missing = [
        ...[...facets].map((f) => `search.facets.${f}`),
        ...[...ranges].map((r) => `search.ranges.${r}`),
      ].filter((key) => typeof at(messages, key) !== 'string');
      assert.deepEqual(missing, []);
    });
  }
});
