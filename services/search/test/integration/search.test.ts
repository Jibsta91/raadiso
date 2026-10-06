// Mapping, analyzers, facets and geo queries against a real OpenSearch
// (same version as the platform; security is exercised by the smoke test).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { demoListings } from '@raadi/catalog/demo';
import { buildEvent } from '@raadi/events';
import { imgproxySigner } from '@raadi/service-kit';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { searchParamsSchema } from '../../src/search/query.js';
import { SearchIndex, toDocument } from '../../src/search/search.index.js';
import { SearchService } from '../../src/search/search.service.js';

let container: StartedTestContainer;
let index: SearchIndex;
let service: SearchService;

const snapshot = (i: number, overrides: Record<string, unknown> = {}) => {
  const l = demoListings(60)[i]!;
  return {
    id: l.id,
    version: 1,
    ownerId: l.ownerId,
    status: 'active' as const,
    category: l.category,
    subcategory: l.subcategory,
    title: l.title,
    description: l.description,
    priceNok: l.priceNok,
    attributes: l.attributes as Record<string, string | number | boolean>,
    location: {
      placeId: l.place.id,
      name: l.place.name,
      county: l.place.county,
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
  service = new SearchService(index, imgproxySigner('00'.repeat(32), '11'.repeat(32)));
  await index.ensureIndex();
  await index.ensureIndex(); // idempotent
  for (let i = 0; i < 60; i++) await index.upsert(toDocument(snapshot(i)), 1);
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
    const categories = r.facets.category.reduce((n, f) => n + f.count, 0);
    assert.equal(categories, 60);
    assert.ok(r.facets.price.length === 5);
    assert.ok(r.items[0]!.image?.thumb.startsWith('/img/'));
  });

  it('keeps counts for other values of a selected facet', async () => {
    const r = await search({ category: 'bil' });
    assert.ok(r.items.every((h) => h.category === 'bil'));
    assert.ok(r.facets.category.length > 1, 'other categories still counted');
  });

  it('full-text search tolerates typos and Norwegian inflection', async () => {
    const target = demoListings(60).find((l) => l.category === 'bil')!;
    const word = target.title.split(' ')[0]!.toLowerCase();
    const typo = word.slice(0, -1) + (word.endsWith('a') ? 'e' : 'a');
    const r = await search({ q: typo });
    assert.ok(
      r.items.some((h) => h.title === target.title),
      `${typo} should find ${target.title}`,
    );
  });

  it('finds the last part of compound words ("sykkel" finds "Terrengsykkel")', async () => {
    const doc = snapshot(59, {
      version: 2,
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
    const first = demoListings(60)[5]!.title;
    const r = await service.suggest(first.slice(0, 4));
    assert.ok(r.includes(first), `${JSON.stringify(r)} should include ${first}`);
  });
});
