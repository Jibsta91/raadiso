import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { SEARCH_PARAM_NAMES, SORTS } from '@raadi/catalog';
import { parse as parseYaml } from 'yaml';
import {
  buildSearch as build,
  facetsFor,
  freshnessOf,
  searchParamsSchema,
} from '../../src/search/query.js';

const parse = (q: Record<string, string>) => searchParamsSchema.parse(q);
interface Bool {
  must: object[];
  filter: object[];
  should?: object[];
}
/** The bool query, inside best match's function_score or on its own (explicit sorts). */
const boolOf = (body: { query: unknown }): Bool => {
  const q = body.query as { bool?: Bool; function_score?: { query: { bool: Bool } } };
  return q.function_score ? q.function_score.query.bool : q.bool!;
};
/** Norway's queries (the original tests); Somaliland's have their own section. */
const buildSearch = (p: ReturnType<typeof parse>) => build(p, 'NO');

describe('search parameters', () => {
  it('parses comma-separated facets and defaults', () => {
    const p = parse({ category: 'bil,torget', region: 'oslo' });
    assert.deepEqual(p.category, ['bil', 'torget']);
    assert.equal(p.page, 1);
    assert.equal(p.pageSize, 24);
    assert.equal(p.sort, 'relevance');
  });

  it('rejects unknown facet values, places and inconsistent ranges', () => {
    for (const bad of [
      { category: 'boats' },
      { near: 'atlantis' },
      { priceMin: '10', priceMax: '5' },
      { yearMin: '2020', yearMax: '2010' },
      { bodyType: 'tank' },
      { horsepowerMin: '100' },
      { lat: '59.9' },
      { sort: 'distance' },
      { pageSize: '500' },
      { foo: 'bar' },
      { county: 'oslo' },
      { country: 'SO' },
    ]) {
      assert.ok(!searchParamsSchema.safeParse(bad).success, JSON.stringify(bad));
    }
  });
});

describe('category filters', () => {
  it('turns range parameters into range filters on the attribute', () => {
    const body = buildSearch(parse({ category: 'bil', yearMin: '2018', mileageMax: '100000' }));
    const filter = boolOf(body).filter;
    assert.ok(
      filter.some(
        (f) =>
          JSON.stringify(f) === JSON.stringify({ range: { 'attributes.year': { gte: 2018 } } }),
      ),
    );
    assert.ok(
      filter.some(
        (f) =>
          JSON.stringify(f) ===
          JSON.stringify({ range: { 'attributes.mileageKm': { lte: 100000 } } }),
      ),
    );
  });

  it('matches car makes case-insensitively and counts them as a facet', () => {
    const p = parse({ make: 'Volvo, TOYOTA' });
    assert.deepEqual(p.make, ['volvo', 'toyota']);
    const body = buildSearch(p);
    assert.deepEqual(body.post_filter.bool.filter, [
      { terms: { 'attributes.make': ['volvo', 'toyota'] } },
    ]);
    assert.ok(body.aggs.make && body.aggs.bodyType && body.aggs.ownership);
  });
});

describe('saved-search window', () => {
  it('filters on the publication time window', () => {
    const body = buildSearch(
      parse({ publishedAfter: '2026-10-04T10:00:00Z', publishedBefore: '2026-10-04T10:05:00Z' }),
    );
    assert.ok(
      boolOf(body).filter.some(
        (f) =>
          JSON.stringify(f) ===
          JSON.stringify({
            range: {
              publishedAt: { gt: '2026-10-04T10:00:00Z', lte: '2026-10-04T10:05:00Z' },
            },
          }),
      ),
    );
    assert.ok(!searchParamsSchema.safeParse({ publishedAfter: 'yesterday' }).success);
  });
});

describe('query builder', () => {
  it('only ever returns active listings of the country searched', () => {
    const body = buildSearch(parse({}));
    assert.deepEqual(boolOf(body).filter[0], { term: { status: 'active' } });
    assert.deepEqual(boolOf(body).filter[1], { term: { country: 'NO' } });
    assert.deepEqual(boolOf(body).must, [{ match_all: {} }]);
    // Relevance ranks running promotions first, without filtering anything out.
    assert.deepEqual(boolOf(body).should, [
      { constant_score: { filter: { range: { promotedUntil: { gt: 'now' } } }, boost: 1000 } },
    ]);
  });

  it('full text is fuzzy and boosts titles, and also matches the ends of compound words', () => {
    const body = buildSearch(parse({ q: 'langrennski' }));
    type MultiMatch = { multi_match: { fields: string[]; fuzziness?: string } };
    const text = boolOf(body).must[0] as { bool: { should: MultiMatch[] } };
    const [words, endings] = text.bool.should.map((c) => c.multi_match);
    // Typos from five letters; most words required, not all (ADR-0041).
    assert.equal(words!.fuzziness, 'AUTO:5,9');
    assert.equal((words as { minimum_should_match?: string }).minimum_should_match, '3<-25%');
    assert.equal(words!.fields[0], 'title^3');
    assert.deepEqual(endings!.fields, ['title.suffix^2', 'description.suffix']);
    assert.equal(endings!.fuzziness, undefined);
  });

  it('searches Somaliland in English and Somali fields, without Norwegian compounds', () => {
    const body = build(parse({ q: 'solar panel' }), 'XS');
    type MultiMatch = { multi_match: { fields: string[] } };
    const text = boolOf(body).must[0] as { bool: { should: MultiMatch[] } };
    assert.equal(text.bool.should.length, 1);
    assert.deepEqual(text.bool.should[0]!.multi_match.fields.slice(0, 2), [
      'title.en^3',
      'title.so^3',
    ]);
    assert.ok(body.suggest, 'asks for spelling suggestions');
  });

  it('boosts what the query named but did not filter, and loosens matching on the retry', () => {
    const body = build(parse({ q: 'phone laptop' }), 'XS', {
      boostCategories: ['mobile-phones'],
      boostValues: { 'attributes.itemType': ['laptop'] },
      relaxed: true,
    });
    const should = JSON.stringify(boolOf(body).should);
    assert.match(should, /"subcategory":\["mobile-phones"\]/);
    assert.match(should, /"attributes.itemType":\["laptop"\]/);
    assert.match(JSON.stringify(boolOf(body).must), /"minimum_should_match":"1"/);
  });

  it('applies a facet to the hits and to other facets, but not to its own counts', () => {
    const body = buildSearch(parse({ category: 'bil', region: 'oslo' }));
    const post = body.post_filter.bool.filter;
    assert.equal(post.length, 2);
    const catAgg = body.aggs.category as { filter: { bool: { filter: object[] } } };
    assert.deepEqual(catAgg.filter.bool.filter, [{ terms: { region: ['oslo'] } }]);
    const regionAgg = body.aggs.region as { filter: { bool: { filter: object[] } } };
    assert.deepEqual(regionAgg.filter.bool.filter, [{ terms: { category: ['bil'] } }]);
  });

  it('geo radius around a place, with distance sort and computed distances', () => {
    const body = buildSearch(parse({ near: 'bergen', radiusKm: '25', sort: 'distance' }));
    assert.deepEqual(boolOf(body).filter[2], {
      geo_distance: { distance: '25km', location: { lat: 60.3913, lon: 5.3221 } },
    });
    assert.ok('_geo_distance' in (body.sort[0] as object));
    assert.equal(boolOf(body).should, undefined, 'explicit sorts ignore promotions');
    assert.ok(body.script_fields?.distance_km);
  });

  it('paginates', () => {
    const body = buildSearch(parse({ page: '3', pageSize: '10' }));
    assert.equal(body.from, 20);
    assert.equal(body.size, 10);
  });
});

describe('countries (ADR-0040)', () => {
  it('searches Somaliland in dollars: typed prices become cents, buckets are its own', () => {
    const body = build(parse({ country: 'XS', priceMin: '50', priceMax: '199.99' }), 'XS');
    assert.deepEqual(boolOf(body).filter[1], { term: { country: 'XS' } });
    assert.ok(
      boolOf(body).filter.some(
        (f) =>
          JSON.stringify(f) ===
          JSON.stringify({ range: { priceMinor: { gte: 5000, lte: 19999 } } }),
      ),
    );
    const price = body.aggs.price as { aggs: { values: { range: { ranges: object[] } } } };
    assert.deepEqual(price.aggs.values.range.ranges[1], { key: '50-199', from: 5000, to: 20000 });
  });

  it('counts the facets of the selected category, or of the country’s categories', () => {
    assert.deepEqual(facetsFor(parse({ category: 'livestock' }), 'XS').sort(), [
      'category',
      'region',
      'sex',
      'subcategory',
    ]);
    const somaliland = facetsFor(parse({}), 'XS');
    assert.ok(somaliland.includes('usage') && somaliland.includes('brand'));
    assert.ok(!somaliland.includes('ownership'), 'a Norwegian facet');
    const vehicles = build(parse({ category: 'vehicles', steering: 'right' }), 'XS');
    assert.ok(vehicles.aggs.steering && vehicles.aggs.usage && !vehicles.aggs.brand);
  });
});

describe('OpenAPI', () => {
  it('documents every query parameter the service accepts, and no other', () => {
    const spec = parseYaml(readFileSync(new URL('../../../openapi.yaml', import.meta.url), 'utf8'));
    const documented = (
      spec.paths['/api/v1/search/listings'].get.parameters as Array<{ name: string }>
    ).map((p) => p.name);
    for (const name of documented) {
      const sample =
        name.endsWith('Min') ||
        name.endsWith('Max') ||
        /^(page|pageSize|radiusKm|lat|lon)$/.test(name)
          ? '1'
          : 'x';
      const issues = searchParamsSchema.safeParse({ [name]: sample });
      const unknown =
        !issues.success && issues.error.issues.some((i) => i.code === 'unrecognized_keys');
      assert.ok(!unknown, `documented but not accepted: ${name}`);
    }
    // Every generated facet and range is documented.
    for (const name of SEARCH_PARAM_NAMES)
      assert.ok(documented.includes(name), `not documented: ${name}`);
    const sort = (
      spec.paths['/api/v1/search/listings'].get.parameters as Array<{
        name: string;
        schema: { enum?: string[] };
      }>
    ).find((p) => p.name === 'sort')!;
    assert.deepEqual([...sort.schema.enum!].sort(), [...SORTS].sort(), 'documented sorts');
  });
});

describe('best match and sorts (ADR-0042)', () => {
  it('multiplies relevance by quality and freshness, and only under best match', () => {
    const body = build(parse({ q: 'sofa' }), 'XS') as { query: Record<string, unknown> };
    const fs = body.query.function_score as {
      functions: Array<{ script_score: { script: { params: Record<string, unknown> } } }>;
      boost_mode: string;
    };
    assert.equal(fs.boost_mode, 'multiply');
    assert.equal(fs.functions[0]!.script_score.script.params.wq, 0.5);
    const lab = build(parse({ q: 'sofa' }), 'XS', { weights: { quality: 2, freshness: 0 } }) as {
      query: { function_score: typeof fs };
    };
    assert.equal(lab.query.function_score.functions[0]!.script_score.script.params.wq, 2);
    const newest = build(parse({ q: 'sofa', sort: 'newest' }), 'XS') as {
      query: Record<string, unknown>;
    };
    assert.equal(newest.query.function_score, undefined);
  });

  it('sorts by a category attribute, missing values last, and by price per square metre', () => {
    const cars = build(parse({ category: 'vehicles', sort: 'year_desc' }), 'XS');
    assert.deepEqual(cars.sort[0], { 'attributes.year': { order: 'desc', missing: '_last' } });
    const homes = build(parse({ category: 'eiendom', sort: 'price_per_area_asc' }), 'NO');
    assert.ok('_script' in (homes.sort[0] as object));
    assert.ok(!searchParamsSchema.safeParse({ sort: 'colour_asc' }).success);
  });

  it('decays freshness to a half 14 days after a two-day grace', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
    assert.equal(freshnessOf(ago(1), now), 1);
    assert.ok(Math.abs(freshnessOf(ago(16), now) - 0.5) < 1e-9);
    assert.ok(freshnessOf(ago(60), now) < 0.01);
  });
});
