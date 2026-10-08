import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEMO_LISTING_COUNT,
  DEMO_LISTINGS_PER_USER,
  DEMO_USERS,
  DEMO_XS_LISTING_COUNT,
  demoListings,
  demoListingsNorway,
  demoUuid,
} from '../src/demo.js';
import { distanceKm, findPlace, PLACES, placesOf, REGIONS } from '../src/places.js';
import { searchParamsSchema } from '../src/search-params.js';
import {
  ALL_ATTRIBUTES,
  attributePayload,
  attributeSchema,
  attributesOf,
  BASE_SORTS,
  SORTS,
  sortsOf,
  CATEGORY_KEYS,
  categoriesOf,
  COUNTRIES,
  COUNTRY_CODES,
  countryOfCategory,
  facetsOf,
  formatMoney,
  isSubcategoryOf,
  parseMajor,
  priceRuleOf,
  rangesOf,
  SUBCATEGORY_KEYS,
  TAXONOMY,
  toMajor,
  toMinor,
} from '../src/taxonomy.js';

describe('countries', () => {
  it('each have a taxonomy, places in every region, and price buckets that tile the range', () => {
    for (const code of COUNTRY_CODES) {
      assert.ok(TAXONOMY[code].length > 0, code);
      const regions = Object.keys(REGIONS[code]);
      for (const r of regions)
        assert.ok(
          placesOf(code).some((p) => p.region === r),
          `${code}: no place in ${r}`,
        );
      const buckets = COUNTRIES[code].priceBuckets;
      assert.equal(buckets[0]!.from, undefined);
      assert.equal(buckets.at(-1)!.to, undefined);
      for (let i = 1; i < buckets.length; i++) assert.equal(buckets[i]!.from, buckets[i - 1]!.to);
    }
  });
});

describe('places', () => {
  it('have unique ids, and coordinates inside their country', () => {
    assert.equal(new Set(PLACES.map((p) => p.id)).size, PLACES.length);
    const box = { NO: [57.9, 71.2, 4.5, 31.2], XS: [8.0, 11.5, 42.5, 49.0] } as const;
    for (const p of PLACES) {
      const [latMin, latMax, lonMin, lonMax] = box[p.country];
      assert.ok(p.lat > latMin && p.lat < latMax && p.lon > lonMin && p.lon < lonMax, p.id);
      assert.ok(Object.hasOwn(REGIONS[p.country], p.region), `${p.id}: ${p.region}`);
    }
  });

  it('computes great-circle distances', () => {
    const d = distanceKm(findPlace('oslo')!, findPlace('bergen')!);
    assert.ok(d > 300 && d < 310, `Oslo–Bergen is ~305 km, got ${d}`);
    const h = distanceKm(findPlace('hargeisa')!, findPlace('berbera')!);
    assert.ok(h > 140 && h < 160, `Hargeisa–Berbera is ~150 km, got ${h}`);
  });
});

describe('money', () => {
  it('converts between major and minor units without float errors', () => {
    assert.equal(toMinor(19.99, 'USD'), 1999);
    assert.equal(toMinor(0.29, 'USD'), 29);
    assert.equal(toMinor(1350, 'NOK'), 135000);
    assert.equal(toMajor(1999, 'USD'), 19.99);
  });

  it('parses typed prices in either notation', () => {
    assert.equal(parseMajor('1 250', 'USD'), 125000);
    assert.equal(parseMajor('1,250.50', 'USD'), 125050);
    assert.equal(parseMajor('1250,5', 'NOK'), 125050);
    assert.equal(parseMajor('12', 'USD'), 1200);
    assert.equal(parseMajor('-3', 'USD'), undefined);
    assert.equal(parseMajor('abc', 'USD'), undefined);
    assert.equal(parseMajor('1.234', 'USD'), 123400);
  });

  it('formats in the reader’s language and the listing’s currency', () => {
    assert.equal(formatMoney({ amountMinor: 125000, currency: 'USD' }, 'en'), '$1,250');
    assert.equal(formatMoney({ amountMinor: 125050, currency: 'USD' }, 'en'), '$1,250.50');
    assert.match(formatMoney({ amountMinor: 135000, currency: 'NOK' }, 'nb'), /^1\s350\skr$/);
  });
});

describe('taxonomy', () => {
  it('has unique ids across all countries', () => {
    const ids = [...CATEGORY_KEYS, ...SUBCATEGORY_KEYS];
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(countryOfCategory('livestock'), 'XS');
    assert.equal(countryOfCategory('personbil'), 'NO');
  });

  it('gives each attribute key one kind and one range name everywhere (one index mapping)', () => {
    for (const roots of Object.values(TAXONOMY))
      for (const root of roots)
        for (const def of [
          ...(root.attributes ?? []),
          ...(root.children ?? []).flatMap((c) => c.attributes ?? []),
        ]) {
          const all = ALL_ATTRIBUTES.get(def.key)!;
          assert.equal(def.kind, all.kind, def.key);
          if (def.kind === 'number' && all.kind === 'number')
            assert.equal(def.range, all.range, def.key);
        }
  });

  it('keeps Norway’s attributes as they were (existing listings stay valid)', () => {
    assert.deepEqual(
      attributesOf('bil', 'personbil').map((a) => a.key),
      ['make', 'model', 'year', 'mileageKm', 'fuel', 'gearbox', 'bodyType', 'drivetrain'],
    );
    assert.deepEqual(
      facetsOf('bil').map((a) => a.key),
      ['make', 'fuel', 'gearbox', 'bodyType', 'drivetrain'],
    );
    assert.deepEqual(
      rangesOf('eiendom').map((r) => r.param),
      ['area', 'bedrooms'],
    );
    assert.equal(priceRuleOf('jobb'), 'none');
    assert.equal(priceRuleOf('torget'), 'required');
  });

  it('merges a category’s and a subcategory’s attributes, optional when not every subcategory has them', () => {
    const cars = attributesOf('vehicles', 'cars').map((a) => a.key);
    assert.ok(cars.includes('steering') && cars.includes('usage'));
    const vehicles = attributesOf('vehicles');
    assert.equal(vehicles.find((a) => a.key === 'model')?.required, false);
    assert.equal(vehicles.find((a) => a.key === 'usage')?.required, false);
    assert.equal(attributesOf('phones', 'mobile-phones')[0]!.key, 'condition');
    assert.equal(priceRuleOf('services', 'tutoring'), 'optional');
  });

  it('generates strict schemas from the definitions', () => {
    const s = attributeSchema('livestock', 'camels');
    assert.ok(s.safeParse({ head: 3, sex: 'female' }).success);
    assert.ok(!s.safeParse({}).success, 'head is required');
    assert.ok(!s.safeParse({ head: 3, colour: 'brown' }).success, 'unknown keys are refused');
    assert.ok(!s.safeParse({ head: 0 }).success);
  });
});

describe('search parameters', () => {
  it('accepts every facet and range of every country, and refuses unknown values', () => {
    const p = searchParamsSchema.parse({
      country: 'XS',
      category: 'vehicles',
      usage: 'foreign_used,locally_used',
      steering: 'right',
      make: 'Toyota',
      yearMin: '2010',
      region: 'maroodi-jeex',
      priceMax: '12500.50',
    });
    assert.deepEqual(p.usage, ['foreign_used', 'locally_used']);
    assert.deepEqual(p.make, ['toyota']);
    assert.equal(p.yearMin, 2010);
    assert.equal(p.priceMax, 12500.5);
    assert.ok(!searchParamsSchema.safeParse({ usage: 'stolen' }).success);
    assert.ok(!searchParamsSchema.safeParse({ country: 'SO' }).success, 'Somaliland is XS');
    assert.ok(!searchParamsSchema.safeParse({ county: 'oslo' }).success, 'county is now region');
  });
});

describe('demo dataset', () => {
  const listings = demoListings();
  const norway = listings.filter((l) => l.country === 'NO');
  const somaliland = listings.filter((l) => l.country === 'XS');

  it('is deterministic, and Norway’s part is unchanged', () => {
    assert.deepEqual(demoListings(), listings);
    assert.deepEqual(demoListingsNorway(), norway);
    assert.equal(demoUuid('listing-0'), listings[0]!.id);
    assert.match(
      listings[0]!.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(norway.length, DEMO_LISTING_COUNT);
    assert.equal(somaliland.length, DEMO_XS_LISTING_COUNT);
  });

  it('is valid against each country’s taxonomy, places and currency', () => {
    for (const l of listings) {
      assert.ok(isSubcategoryOf(l.category, l.subcategory), `${l.category}/${l.subcategory}`);
      assert.equal(countryOfCategory(l.category), l.country, l.id);
      assert.equal(l.place.country, l.country, l.id);
      const parsed = attributeSchema(l.category, l.subcategory).safeParse(l.attributes);
      assert.ok(parsed.success, `${l.id}: ${JSON.stringify(parsed.error?.issues)}`);
      const rule = priceRuleOf(l.category, l.subcategory);
      if (rule === 'none') assert.equal(l.price, null, l.id);
      if (rule === 'required') assert.ok(l.price, l.id);
      if (l.price) assert.equal(l.price.currency, COUNTRIES[l.country].currency);
      assert.ok(l.images.length >= 1 && l.images.length <= 3);
    }
  });

  it('keeps every seller under the active-listing quota (OPA: 50)', () => {
    const perOwner = new Map<string, number>();
    for (const l of listings) perOwner.set(l.ownerId, (perOwner.get(l.ownerId) ?? 0) + 1);
    for (const [owner, n] of perOwner) assert.ok(n < 50, `${owner} owns ${n}`);
    for (const u of DEMO_USERS) assert.equal(perOwner.get(u.id), DEMO_LISTINGS_PER_USER);
  });

  it('has unique listing and image ids', () => {
    assert.equal(new Set(listings.map((l) => l.id)).size, listings.length);
    const ids = listings.flatMap((l) => l.images.map((i) => i.id));
    assert.equal(new Set(ids).size, ids.length);
  });

  it('covers every subcategory of both countries, so each category page has listings in every tile', () => {
    for (const code of COUNTRY_CODES)
      for (const c of categoriesOf(code))
        for (const s of c.children ?? [])
          assert.ok(
            listings.some((l) => l.category === c.id && l.subcategory === s.id),
            `${c.id}/${s.id}`,
          );
  });
});

describe('form fields', () => {
  it('shape form values into a payload the schema accepts', () => {
    const payload = attributePayload('bil', 'personbil', {
      make: ' Volvo ',
      model: 'V60',
      year: '2019',
      mileageKm: '85000',
      fuel: 'diesel',
      gearbox: 'automatic',
      bodyType: '',
    });
    assert.deepEqual(payload, {
      make: 'Volvo',
      model: 'V60',
      year: 2019,
      mileageKm: 85000,
      fuel: 'diesel',
      gearbox: 'automatic',
    });
    assert.ok(attributeSchema('bil', 'personbil').safeParse(payload).success);
  });
});

describe('sorts (ADR-0042)', () => {
  it('come from attributes that declare an order, per category', () => {
    assert.deepEqual(sortsOf('vehicles', 'cars').slice(5), ['year_desc', 'mileage_asc']);
    assert.ok(sortsOf('eiendom').includes('price_per_area_asc'));
    assert.ok(sortsOf('property', 'land').includes('area_desc'));
    assert.ok(!sortsOf('jobb').includes('price_per_area_asc'));
    assert.deepEqual(sortsOf('torget'), [...BASE_SORTS]);
    assert.ok(SORTS.includes('head_desc') && SORTS.includes('storage_desc'));
  });
});
