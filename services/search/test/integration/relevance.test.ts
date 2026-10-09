// Relevance (ADR-0041): the judged queries in test/relevance/judgements.json against every demo listing
// in a real OpenSearch. Reports precision of the top results and the zero-result rate, and fails below
// the floors recorded there, so a change that makes search worse cannot pass.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { demoListings } from '@raadi/catalog/demo';
import { imgproxySigner } from '@raadi/service-kit';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { searchParamsSchema } from '../../src/search/query.js';
import { SearchIndex, toDocument } from '../../src/search/search.index.js';
import { SearchService } from '../../src/search/search.service.js';

interface Judgement {
  country: 'XS' | 'NO';
  q: string;
  k?: number;
  expect: { subcategory?: string; category?: string; region?: string; title?: string };
}
const { floors, judgements } = JSON.parse(
  readFileSync(new URL('../../../test/relevance/judgements.json', import.meta.url), 'utf8'),
) as { floors: { precision: number; zeroResults: number }; judgements: Judgement[] };

let container: StartedTestContainer;
let service: SearchService;

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
  const index = new SearchIndex(
    `http://${container.getHost()}:${container.getMappedPort(9200)}`,
    'x',
    'x',
    'raadi-listings',
  );
  service = new SearchService(index, imgproxySigner('00'.repeat(32), '11'.repeat(32)), 'XS');
  await index.ensureIndex();
  const now = Date.now();
  const body = demoListings().flatMap((l, i) => [
    { index: { _index: 'raadi-listings', _id: l.id, version: 1, version_type: 'external' } },
    toDocument({
      id: l.id,
      version: 1,
      ownerId: l.ownerId,
      status: 'active',
      country: l.country,
      category: l.category,
      subcategory: l.subcategory,
      title: l.title,
      description: l.description,
      priceNok: l.price?.currency === 'NOK' ? l.price.amountMinor / 100 : null,
      price: l.price,
      attributes: l.attributes,
      location: {
        placeId: l.place.id,
        name: l.place.name,
        county: l.place.region,
        region: l.place.region,
        lat: l.place.lat,
        lon: l.place.lon,
      },
      imageIds: l.images.map((img) => img.id),
      publishedAt: new Date(now - l.ageDays * 86_400_000 - i * 60_000).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }),
  ]);
  const res = await index.client.bulk({ body, refresh: true });
  assert.equal(res.body.errors, false, 'every demo listing indexed');
});

after(async () => {
  await container?.stop();
});

describe('relevance (judged queries)', () => {
  it(`reaches precision ${floors.precision} with at most ${floors.zeroResults} empty results`, async (t) => {
    const rows: string[] = [];
    let precision = 0;
    let empty = 0;
    for (const j of judgements) {
      const k = j.k ?? 5;
      const r = await service.search(
        searchParamsSchema.parse({ q: j.q, country: j.country, pageSize: String(k) }),
      );
      const good = r.items.filter((h) =>
        j.expect.subcategory
          ? h.subcategory === j.expect.subcategory
          : j.expect.category
            ? h.category === j.expect.category
            : j.expect.region
              ? h.location.region === j.expect.region
              : h.title.toLowerCase().includes(j.expect.title!),
      ).length;
      const p = r.items.length ? good / r.items.length : 0;
      if (!r.items.length) empty++;
      precision += p;
      const read = r.query.understood.map((u) => `${u.kind}:${Object.values(u.set).join('/')}`);
      rows.push(
        `${p.toFixed(2)}  ${j.country} ${JSON.stringify(j.q).padEnd(24)} ${String(r.total).padStart(3)} hits  ${read.join(' ')}${r.query.text ? `  text:"${r.query.text}"` : ''}${r.relaxed ? '  (relaxed)' : ''}`,
      );
    }
    const mean = precision / judgements.length;
    // The table shows in the test report: which query is read how, and how well it does.
    t.diagnostic(
      `${rows.join('\n')}\nmean precision ${mean.toFixed(2)}, ${empty}/${judgements.length} empty`,
    );
    assert.ok(mean >= floors.precision, `precision ${mean.toFixed(2)} < ${floors.precision}`);
    assert.ok(empty <= floors.zeroResults, `${empty} queries without results`);
  });
});

describe('autocomplete', () => {
  it('offers categories with counts, title completions and places as people type', async () => {
    const ca = await service.autocomplete('ca', 'XS');
    assert.ok(
      ca.categories.some((c) => c.subcategory === 'cars' && c.count > 0),
      JSON.stringify(ca),
    );
    assert.ok(
      (await service.autocomplete('cam', 'XS')).categories.some((c) => c.subcategory === 'camels'),
    );
    const geel = await service.autocomplete('geel', 'XS');
    assert.equal(geel.categories[0]?.subcategory, 'camels');
    const har = await service.autocomplete('har', 'XS');
    assert.deepEqual(har.places, [{ placeId: 'hargeisa', name: 'Hargeisa' }]);
    const toy = await service.autocomplete('toyo', 'XS');
    assert.ok(
      toy.queries.some((t) => t.startsWith('Toyota')),
      JSON.stringify(toy.queries),
    );
    assert.equal(toy.categories[0]?.subcategory, 'cars');
    const norway = await service.autocomplete('so', 'NO');
    assert.ok(
      norway.categories.some((c) => c.subcategory === 'mobler'),
      'sofa → Møbler',
    );
    assert.ok(!norway.categories.some((c) => c.category === 'home'), 'no Somaliland categories');
  });
});

describe('no dead ends', () => {
  it('drops what it read into the query when that hides what the words alone find', async () => {
    // "car" reads as Cars, but the remote-control car is a toy: the words alone find it.
    const r = await service.search(
      searchParamsSchema.parse({ q: 'remote control car', country: 'XS' }),
    );
    assert.ok(r.items.length > 0, 'found');
    assert.ok(
      r.items.every((h) => /remote-control car/i.test(h.title)),
      JSON.stringify(r.items),
    );
    assert.deepEqual(r.query.understood, [], 'and says it read nothing into them');
  });

  it('retries with any word allowed when no listing has them all, and says so', async () => {
    const r = await service.search(
      searchParamsSchema.parse({ q: 'toyota zebra stripes', country: 'XS' }),
    );
    assert.equal(r.relaxed, true);
    assert.ok(r.items.length > 0 && r.items.every((h) => /toyota/i.test(h.title)));
    const exact = await service.search(
      searchParamsSchema.parse({ q: 'toyota car', country: 'XS', understand: 'false' }),
    );
    assert.deepEqual(exact.query.understood, [], 'understand=false reads nothing into the words');
    assert.equal(exact.query.text, 'toyota car');
  });
});

describe('best match (ADR-0042)', () => {
  it('puts complete, fresh listings first when there are no words', async () => {
    const r = await service.rankingLab(
      searchParamsSchema.parse({ category: 'phones', country: 'XS', pageSize: '48' }),
      { quality: 0.5, freshness: 0.5 },
    );
    const top = r.items.slice(0, 5);
    const rest = r.items.slice(5);
    const mean = (xs: typeof r.items) =>
      xs.reduce((n, x) => n + x.multiplier, 0) / Math.max(xs.length, 1);
    assert.ok(rest.length > 0 && mean(top) >= mean(rest), 'better multipliers rank higher');
    for (const x of r.items)
      assert.ok(Math.abs(x.relevance * x.multiplier - x.score) < 0.01 * Math.max(x.score, 1), x.id);
  });

  it('previews other weights: with quality weighed heavily, the best-described lead', async () => {
    const params = searchParamsSchema.parse({
      category: 'vehicles',
      country: 'XS',
      pageSize: '48',
    });
    const heavy = await service.rankingLab(params, { quality: 3, freshness: 0 });
    const qualities = heavy.items.map((x) => x.quality);
    assert.deepEqual(
      qualities,
      [...qualities].sort((a, b) => b - a),
    );
  });

  it('sorts cars by model year, newest first, and homes by price per square metre', async () => {
    const cars = await service.search(
      searchParamsSchema.parse({
        country: 'XS',
        category: 'vehicles',
        subcategory: 'cars',
        sort: 'year_desc',
      }),
    );
    const years = cars.items.map((h) => Number(h.attributes.year));
    assert.ok(years.length > 2);
    assert.deepEqual(
      years,
      [...years].sort((a, b) => b - a),
    );
    const homes = await service.search(
      searchParamsSchema.parse({
        country: 'NO',
        category: 'eiendom',
        subcategory: 'salg',
        sort: 'price_per_area_asc',
      }),
    );
    const perArea = homes.items.map((h) => h.price!.amountMinor / Number(h.attributes.areaM2));
    assert.deepEqual(
      perArea,
      [...perArea].sort((a, b) => a - b),
    );
  });
});

describe('price insight (ADR-0043)', () => {
  const ids = demoListings();
  it('rates a car against cars of its make and model, and a plot per square metre', async () => {
    const car = ids.find((l) => l.subcategory === 'cars' && l.title.startsWith('Toyota'))!;
    const insight = await service.priceInsight(car.id);
    assert.ok(insight, 'enough comparable cars');
    assert.equal(insight.stats.unit, 'listing');
    assert.ok(insight.stats.comparables >= 4);
    assert.ok(['unusually_low', 'great', 'good', 'fair', 'high'].includes(insight.rating));
    assert.ok(
      insight.stats.p25 <= insight.stats.median && insight.stats.median <= insight.stats.p75,
    );
    const plot = ids.find((l) => l.subcategory === 'land')!;
    const land = await service.priceInsight(plot.id);
    assert.equal(land?.stats.unit, 'areaM2');
  });

  it('shows good news on result cards, and guides a seller', async () => {
    const r = await service.search(
      searchParamsSchema.parse({ country: 'XS', category: 'phones', pageSize: '48' }),
    );
    assert.ok(
      r.items.some((h) => h.deal === 'great' || h.deal === 'good'),
      'some deals',
    );
    assert.ok(r.items.every((h) => h.deal === undefined || ['great', 'good'].includes(h.deal)));
    const guide = await service.priceGuide({
      country: 'XS',
      category: 'livestock',
      subcategory: 'camels',
      attributes: { head: 2 },
    });
    assert.equal(guide?.unit, 'head');
    assert.equal(guide?.currency, 'USD');
  });
});

describe('similar listings (ADR-0047)', () => {
  it('finds listings like a car among cars, never the car itself, and tops up to the size', async () => {
    const car = demoListings().find(
      (l) => l.subcategory === 'cars' && l.title.startsWith('Toyota'),
    )!;
    const similar = await service.similar(car.id);
    assert.equal(similar.length, 8);
    assert.ok(!similar.some((h) => h.id === car.id));
    assert.ok(
      similar.slice(0, 4).every((h) => h.category === 'vehicles'),
      JSON.stringify(similar.map((h) => h.title)),
    );
    assert.deepEqual(await service.similar('00000000-0000-4000-8000-000000000000'), []);
  });
});
