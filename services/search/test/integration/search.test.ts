// Mapping, analyzers, facets and geo queries against a real OpenSearch
// (same version as the platform; security is exercised by the smoke test).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { demoListingsNorway, demoListingsSomaliland, type DemoListing } from '@raadi/catalog/demo';
import { buildEvent } from '@raadi/events';
import { imgproxySigner } from '@raadi/service-kit';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { searchParamsSchema } from '../../src/search/query.js';
import { SearchIndex, toDocument } from '../../src/search/search.index.js';
import { SearchService } from '../../src/search/search.service.js';

let container: StartedTestContainer;
let index: SearchIndex;
let service: SearchService;

const NORWAY = demoListingsNorway(60);
const SOMALILAND = demoListingsSomaliland(40);

const fromDemo = (l: DemoListing, i: number, overrides: Record<string, unknown> = {}) => ({
  id: l.id,
  version: 1,
  ownerId: l.ownerId,
  status: 'active' as const,
  country: l.country,
  category: l.category,
  subcategory: l.subcategory,
  title: l.title,
  description: l.description,
  priceNok: l.price?.currency === 'NOK' ? l.price.amountMinor / 100 : null,
  price: l.price,
  attributes: l.attributes as Record<string, string | number | boolean>,
  location: {
    placeId: l.place.id,
    name: l.place.name,
    county: l.place.region,
    region: l.place.region,
    lat: l.place.lat,
    lon: l.place.lon,
  },
  imageIds: l.images.map((img) => img.id),
  publishedAt: new Date(Date.now() - i * 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const snapshot = (i: number, overrides: Record<string, unknown> = {}) => {
  const l = NORWAY[i]!;
  return {
    id: l.id,
    version: 1,
    ownerId: l.ownerId,
    status: 'active' as const,
    category: l.category,
    subcategory: l.subcategory,
    title: l.title,
    description: l.description,
    // As events from before ADR-0040: kroner, a county, no country.
    priceNok: l.price === null ? null : l.price.amountMinor / 100,
    attributes: l.attributes as Record<string, string | number | boolean>,
    location: {
      placeId: l.place.id,
      name: l.place.name,
      county: l.place.region,
      lat: l.place.lat,
      lon: l.place.lon,
    },
    imageIds: l.images.map((img) => img.id),
    publishedAt: new Date(Date.now() - i * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
};

before(async () => {
  container = await new GenericContainer('opensearchproject/opensearch:3.9.0')
    .withEnvironment({
      'discovery.type': 'single-node',
      DISABLE_SECURITY_PLUGIN: 'true',
      DISABLE_INSTALL_DEMO_CONFIG: 'true',
      OPENSEARCH_JAVA_OPTS: '-Xms256m -Xmx256m',
    })
    .withExposedPorts(9200)
    .withWaitStrategy(Wait.forHttp('/_cluster/health', 9200).forStatusCode(200))
    .withStartupTimeout(180_000)
    .start();
  index = new SearchIndex(
    `http://${container.getHost()}:${container.getMappedPort(9200)}`,
    'x',
    'x',
    'raadi-listings',
  );
  service = new SearchService(index, imgproxySigner('00'.repeat(32), '11'.repeat(32)), 'NO');
  await index.ensureIndex();
  await index.ensureIndex(); // idempotent
  for (let i = 0; i < 60; i++) await index.upsert(toDocument(snapshot(i)), 1);
  for (const [i, l] of SOMALILAND.entries()) await index.upsert(toDocument(fromDemo(l, i)), 1);
  await index.client.indices.refresh({ index: 'raadi-listings' });
});

after(async () => {
  await container?.stop();
});

const search = (q: Record<string, string>) => service.search(searchParamsSchema.parse(q));

describe('SearchIndex + SearchService', () => {
  it('indexes everything and returns facets', async () => {
    const r = await search({});
    assert.equal(r.total, 60);
    const categories = r.facets.category!.reduce((n, f) => n + f.count, 0);
    assert.equal(categories, 60);
    assert.equal(r.country, 'NO');
    assert.equal(r.currency, 'NOK');
    assert.equal(r.priceRanges.length, 5);
    assert.equal(
      r.priceRanges.reduce((n, b) => n + b.count, 0),
      NORWAY.filter((l) => l.price).length,
    );
    assert.ok(r.items[0]!.image?.thumb.startsWith('/img/'));
  });

  it('keeps counts for other values of a selected facet', async () => {
    const r = await search({ category: 'bil' });
    assert.ok(r.items.every((h) => h.category === 'bil'));
    assert.ok(r.facets.category!.length > 1, 'other categories still counted');
  });

  it('full-text search tolerates typos and Norwegian inflection', async () => {
    const target = NORWAY.find((l) => l.category === 'bil')!;
    const word = target.title.split(' ')[0]!.toLowerCase();
    const typo = word.slice(0, -1) + (word.endsWith('a') ? 'e' : 'a');
    const r = await search({ q: typo });
    assert.ok(
      r.items.some((h) => h.title === target.title),
      `${typo} should find ${target.title}`,
    );
  });

  it('finds the last part of compound words ("sykkel" finds "Terrengsykkel")', async () => {
    // A mountain bike, in Sport like any (search reads "sykkel" as that category, ADR-0041).
    const doc = snapshot(59, {
      version: 2,
      category: 'torget',
      subcategory: 'sport',
      attributes: { condition: 'good' },
      title: 'Terrengsykkel fra Trek, 29 tommer',
      description: 'Lite brukt, nye dekk.',
    });
    await index.upsert(toDocument(doc), 2);
    await index.client.indices.refresh({ index: 'raadi-listings' });
    for (const q of ['sykkel', 'Terrengsykkel', 'trek sykkel']) {
      const r = await search({ q });
      assert.ok(
        r.items.some((h) => h.id === doc.id),
        `${q} should find ${doc.title}`,
      );
    }
  });

  it('filters by radius and sorts by distance', async () => {
    const r = await search({ near: 'oslo', radiusKm: '600', sort: 'distance' });
    const d = r.items.map((h) => h.distanceKm!);
    assert.ok(d.length > 0 && d.every((x) => x <= 600));
    assert.deepEqual(
      [...d].sort((a, b) => a - b),
      d,
    );
  });

  it('applies events idempotently and in version order', async () => {
    const s = snapshot(0, { title: 'Oppdatert tittel', version: 3 });
    assert.equal(await index.upsert(toDocument(s), 3), 'indexed');
    assert.equal(await index.upsert(toDocument(snapshot(0, { version: 2 })), 2), 'stale');
    const deleted = buildEvent('no.raadi.listings.listing.deleted.v1', {
      source: 't',
      subject: s.id,
      data: { listingId: s.id, version: 4, imageIds: [] },
    });
    await service.onListingEvent({
      topic: 't',
      partition: 0,
      offset: 0n,
      key: s.id,
      headers: {},
      value: deleted,
    });
    await service.onListingEvent({
      topic: 't',
      partition: 0,
      offset: 1n,
      key: s.id,
      headers: {},
      value: deleted,
    });
    await index.client.indices.refresh({ index: 'raadi-listings' });
    assert.equal((await search({})).total, 59);
  });

  it('migrates to a new index version by copying documents and moving the alias', async () => {
    const url = `http://${container.getHost()}:${container.getMappedPort(9200)}`;
    const migrating = new SearchIndex(url, 'x', 'x', 'migrate-test');
    const doc = toDocument(snapshot(1));
    await migrating.client.indices.create({ index: 'migrate-test-v0' });
    await migrating.client.indices.putAlias({ index: 'migrate-test-v0', name: 'migrate-test' });
    await migrating.client.index({
      index: 'migrate-test-v0',
      id: doc.id,
      body: doc,
      version: 7,
      version_type: 'external',
      refresh: true,
    });

    await migrating.ensureIndex();

    const targets = await migrating.client.indices.getAlias({ name: 'migrate-test' });
    assert.deepEqual(Object.keys(targets.body), [migrating.indexName]);
    const copied = await migrating.client.get({ index: migrating.indexName, id: doc.id });
    assert.equal(copied.body._version, 7);
    assert.equal(await migrating.upsert(doc, 6), 'stale');
  });

  it('suggests titles for prefixes', async () => {
    const first = NORWAY[5]!.title;
    const r = await service.suggest(first.slice(0, 4));
    assert.ok(r.includes(first), `${JSON.stringify(r)} should include ${first}`);
  });
});

describe('countries (ADR-0040)', () => {
  it('searches one country at a time, with its own prices, regions and facets', async () => {
    const r = await search({ country: 'XS' });
    assert.equal(r.total, SOMALILAND.length);
    assert.equal(r.currency, 'USD');
    assert.ok(r.items.every((h) => h.country === 'XS' && (!h.price || h.price.currency === 'USD')));
    assert.ok(r.facets.region!.some((f) => f.value === 'maroodi-jeex'));
    const hargeisa = (await search({ country: 'XS', near: 'hargeisa', radiusKm: '5' })).items[0];
    assert.equal(hargeisa?.location.regionName, 'Maroodi Jeex');
    assert.equal(r.priceRanges[0]!.key, '0-49');
    const norway = await search({});
    assert.ok(
      norway.items.every((h) => h.country === 'NO'),
      'the default country is Norway here',
    );
  });

  it('filters prices typed in dollars against cents', async () => {
    const r = await search({ country: 'XS', priceMin: '1000', sort: 'price_asc' });
    const prices = r.items.map((h) => h.price!.amountMinor);
    assert.ok(prices.length > 0 && prices.every((p) => p >= 100_000));
    assert.deepEqual(
      [...prices].sort((a, b) => a - b),
      prices,
    );
  });

  it('suggests only titles of the country searched', async () => {
    const phone = SOMALILAND.find((l) => l.subcategory === 'mobile-phones')!.title;
    assert.ok((await service.suggest(phone.slice(0, 5), 'XS')).includes(phone));
    assert.ok(!(await service.suggest(phone.slice(0, 5), 'NO')).includes(phone));
  });

  it('upgrades version 4 documents (kroner, county, no country) while copying them', async () => {
    const url = `http://${container.getHost()}:${container.getMappedPort(9200)}`;
    const migrating = new SearchIndex(url, 'x', 'x', 'v4-test');
    await migrating.client.indices.create({ index: 'v4-test-v4' });
    await migrating.client.indices.putAlias({ index: 'v4-test-v4', name: 'v4-test' });
    const old = snapshot(2);
    await migrating.client.index({
      index: 'v4-test-v4',
      id: old.id,
      body: {
        ...toDocument(old),
        country: undefined,
        priceMinor: undefined,
        currency: undefined,
        region: undefined,
        priceNok: old.priceNok,
        county: old.location.county,
      },
      version: 3,
      version_type: 'external',
      refresh: true,
    });
    await migrating.ensureIndex();
    const copied = await migrating.client.get({ index: migrating.indexName, id: old.id });
    const doc = copied.body._source as Record<string, unknown>;
    assert.equal(doc.country, 'NO');
    assert.equal(doc.region, old.location.county);
    assert.equal(doc.priceMinor, old.priceNok === null ? null : old.priceNok * 100);
    assert.equal(doc.currency, old.priceNok === null ? null : 'NOK');
    assert.ok(!('priceNok' in doc) && !('county' in doc));
  });
});
