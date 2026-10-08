import {
  APPLIANCE_TYPES,
  BODY_TYPES,
  COMMERCIAL_TYPES,
  COMPUTER_TYPES,
  CONDITIONS,
  DEAL_TYPES,
  DRIVETRAINS,
  EMPLOYMENT_TYPES,
  FUELS,
  FURNISHING,
  GEARBOXES,
  HOME_TYPES,
  LAND_USES,
  LIVESTOCK_SEX,
  OWNERSHIPS,
  PHONE_BRANDS,
  PROPERTY_TYPES,
  SOLAR_TYPES,
  STEERING,
  USAGES,
} from './attribute-values.js';
import type { CountryCode } from './countries.js';

/*
 * Marketplace taxonomy as data, one tree per country (ADR-0040). Ids are stable ASCII slugs, unique
 * across countries: they are stored on listings and used in URLs, events, the search index and the
 * message catalogues (display names live there). Never rename an id; append new ones. Two levels place
 * a listing (category, subcategory); a third level is a navigational attribute such as `itemType`.
 * The validation schemas, search parameters, facets, range filters and index mapping are generated from
 * these definitions. Zod-free, so the app can import it.
 */

export type AttributeDef =
  | (AttributeBase & { kind: 'select'; options: readonly string[] })
  | (AttributeBase & { kind: 'text'; maxLength: number })
  | (AttributeBase & {
      kind: 'number';
      min: number;
      max: number;
      /** Shown next to the input (km, m², GB). */
      unit?: string;
      /** Searchable as `<range>Min` / `<range>Max` ("from – to"). */
      range?: string;
    });

interface AttributeBase {
  key: string;
  required: boolean;
  /** A multi-value search filter with counts. Text facets match case-insensitively (lower-cased). */
  facet?: boolean;
}

/** Whether a listing in the category has an asking price. */
export type PriceRule = 'required' | 'optional' | 'none';
/** What the price is per, for rentals and stays. */
export type PriceUnit = 'month' | 'night';

export interface CategoryNode {
  id: string;
  /** Attributes of every listing in this node (and, on a category, in all its subcategories). */
  attributes?: readonly AttributeDef[];
  price?: PriceRule;
  priceUnit?: PriceUnit;
  /** Subcategories (on a category only). */
  children?: readonly CategoryNode[];
}

const year = (required: boolean): AttributeDef => ({
  key: 'year',
  kind: 'number',
  required,
  min: 1900,
  max: new Date().getUTCFullYear() + 1,
  range: 'year',
});
const mileage = (required: boolean): AttributeDef => ({
  key: 'mileageKm',
  kind: 'number',
  required,
  min: 0,
  max: 2_000_000,
  unit: 'km',
  range: 'mileage',
});
const area = (required: boolean): AttributeDef => ({
  key: 'areaM2',
  kind: 'number',
  required,
  min: 1,
  max: 1_000_000,
  unit: 'm²',
  range: 'area',
});
const bedrooms: AttributeDef = {
  key: 'bedrooms',
  kind: 'number',
  required: false,
  min: 0,
  max: 50,
  range: 'bedrooms',
};
const guests: AttributeDef = {
  key: 'guests',
  kind: 'number',
  required: true,
  min: 1,
  max: 50,
  range: 'guests',
};
const select = (
  key: string,
  options: readonly string[],
  required = true,
  facet = true,
): AttributeDef => ({ key, kind: 'select', options, required, facet });
const make: AttributeDef = {
  key: 'make',
  kind: 'text',
  required: true,
  maxLength: 40,
  facet: true,
};
const model: AttributeDef = { key: 'model', kind: 'text', required: true, maxLength: 60 };
const employer: AttributeDef = { key: 'employer', kind: 'text', required: true, maxLength: 80 };
const condition = select('condition', CONDITIONS);
const leaves = (...ids: string[]): CategoryNode[] => ids.map((id) => ({ id }));

/** Norway (test country): FINN's main groups, the ids the Norwegian demo data uses (ADR-0024). */
const NORWAY: readonly CategoryNode[] = [
  {
    id: 'torget',
    attributes: [condition],
    children: leaves(
      'elektronikk',
      'mobler',
      'klaer',
      'sport',
      'barn',
      'hobby',
      'hage',
      'antikviteter',
      'dyr',
      'kjoretoyutstyr',
    ),
  },
  {
    id: 'bil',
    attributes: [
      make,
      model,
      year(true),
      mileage(true),
      select('fuel', FUELS),
      select('gearbox', GEARBOXES),
      select('bodyType', BODY_TYPES, false),
      select('drivetrain', DRIVETRAINS, false),
    ],
    children: leaves('personbil', 'varebil', 'motorsykkel', 'bobil'),
  },
  {
    id: 'eiendom',
    attributes: [
      select('propertyType', PROPERTY_TYPES),
      area(true),
      bedrooms,
      select('ownership', OWNERSHIPS, false),
    ],
    children: [
      { id: 'salg' },
      { id: 'utleie', priceUnit: 'month' },
      { id: 'fritid' },
      { id: 'tomt' },
      { id: 'nybygg' },
      { id: 'naering' },
    ],
  },
  {
    id: 'jobb',
    price: 'none',
    attributes: [employer, select('employmentType', EMPLOYMENT_TYPES)],
    children: leaves(
      'it',
      'helse',
      'bygg',
      'undervisning',
      'handel',
      'transport',
      'kontor',
      'industri',
      'reiseliv',
    ),
  },
  {
    id: 'reise',
    attributes: [guests],
    children: leaves('hytteutleie', 'leilighet', 'pakkereise'),
  },
];

/**
 * Somaliland (first market, ADR-0033): what people there buy and sell, after the big African
 * classifieds (Jiji, Locanto). Imported cars are "foreign used" or "locally used", and the steering side
 * matters; livestock is sold by the head; solar power and phones are big categories of their own.
 */
const SOMALILAND: readonly CategoryNode[] = [
  {
    id: 'vehicles',
    children: [
      {
        id: 'cars',
        attributes: [
          make,
          model,
          year(true),
          mileage(false),
          select('usage', USAGES),
          select('fuel', FUELS),
          select('gearbox', GEARBOXES),
          select('steering', STEERING, false),
          select('bodyType', BODY_TYPES, false),
        ],
      },
      { id: 'motorcycles', attributes: [make, year(false), select('usage', USAGES)] },
      {
        id: 'trucks-buses',
        attributes: [
          make,
          year(true),
          mileage(false),
          select('usage', USAGES),
          select('fuel', FUELS),
        ],
      },
      { id: 'auto-parts', attributes: [condition] },
    ],
  },
  {
    id: 'property',
    children: [
      {
        id: 'houses-rent',
        priceUnit: 'month',
        attributes: [
          select('propertyType', HOME_TYPES),
          bedrooms,
          select('furnishing', FURNISHING, false),
        ],
      },
      {
        id: 'houses-sale',
        attributes: [select('propertyType', HOME_TYPES), bedrooms, area(false)],
      },
      { id: 'land', attributes: [area(true), select('landUse', LAND_USES)] },
      {
        id: 'commercial-property',
        attributes: [
          select('propertyType', COMMERCIAL_TYPES),
          select('dealType', DEAL_TYPES),
          area(false),
        ],
      },
      { id: 'short-stays', priceUnit: 'night', attributes: [guests] },
    ],
  },
  {
    id: 'phones',
    attributes: [condition],
    children: [
      {
        id: 'mobile-phones',
        attributes: [
          select('brand', PHONE_BRANDS),
          {
            key: 'storageGb',
            kind: 'number',
            required: false,
            min: 1,
            max: 4096,
            unit: 'GB',
            range: 'storage',
          },
        ],
      },
      { id: 'tablets', attributes: [select('brand', PHONE_BRANDS)] },
      { id: 'phone-accessories' },
    ],
  },
  {
    id: 'electronics',
    attributes: [condition],
    children: [
      { id: 'computers', attributes: [select('itemType', COMPUTER_TYPES)] },
      { id: 'solar-power', attributes: [select('itemType', SOLAR_TYPES)] },
      { id: 'appliances', attributes: [select('itemType', APPLIANCE_TYPES)] },
      { id: 'tv-audio' },
    ],
  },
  {
    id: 'home',
    attributes: [condition],
    children: leaves('furniture', 'kitchenware', 'home-decor'),
  },
  {
    id: 'fashion',
    attributes: [condition],
    children: leaves('mens-clothing', 'womens-clothing', 'shoes', 'jewellery-watches', 'bags'),
  },
  {
    id: 'livestock',
    attributes: [
      { key: 'head', kind: 'number', required: true, min: 1, max: 10_000, range: 'head' },
      select('sex', LIVESTOCK_SEX, false),
    ],
    children: leaves('camels', 'goats-sheep', 'cattle', 'poultry'),
  },
  {
    id: 'agriculture',
    children: [
      { id: 'farm-produce' },
      { id: 'animal-feed' },
      { id: 'farm-equipment', attributes: [condition] },
    ],
  },
  {
    id: 'jobs',
    price: 'none',
    attributes: [employer, select('employmentType', EMPLOYMENT_TYPES)],
    children: leaves(
      'ngo-jobs',
      'it-jobs',
      'sales-jobs',
      'driver-jobs',
      'teaching-jobs',
      'health-jobs',
      'construction-jobs',
      'hospitality-jobs',
      'office-jobs',
    ),
  },
  {
    id: 'services',
    price: 'optional',
    children: leaves(
      'building-trades',
      'transport-logistics',
      'tutoring',
      'it-services',
      'events-catering',
      'beauty-services',
      'repair-services',
    ),
  },
  {
    id: 'business',
    children: [{ id: 'business-equipment', attributes: [condition] }, { id: 'wholesale' }],
  },
  {
    id: 'kids',
    attributes: [condition],
    children: leaves('baby-gear', 'toys', 'kids-clothing'),
  },
  {
    id: 'sports-hobbies',
    attributes: [condition],
    children: leaves('sports-equipment', 'books', 'musical-instruments'),
  },
];

export const TAXONOMY: Record<CountryCode, readonly CategoryNode[]> = {
  XS: SOMALILAND,
  NO: NORWAY,
};

/** Category and subcategory ids are plain strings: the taxonomy is data. */
export type Category = string;
export type Subcategory = string;

interface Entry {
  node: CategoryNode;
  country: CountryCode;
}
const CATEGORY_INDEX = new Map<string, Entry>();
const SUBCATEGORY_INDEX = new Map<string, Entry & { parent: CategoryNode }>();
for (const [code, roots] of Object.entries(TAXONOMY) as Array<
  [CountryCode, readonly CategoryNode[]]
>) {
  for (const root of roots) {
    CATEGORY_INDEX.set(root.id, { node: root, country: code });
    for (const child of root.children ?? []) {
      SUBCATEGORY_INDEX.set(child.id, { node: child, country: code, parent: root });
    }
  }
}

/** Every category id of every country. */
export const CATEGORY_KEYS: readonly Category[] = [...CATEGORY_INDEX.keys()];
/** Every subcategory id of every country. */
export const SUBCATEGORY_KEYS: readonly Subcategory[] = [...SUBCATEGORY_INDEX.keys()];

/** The categories of a country, in display order. */
export function categoriesOf(code: CountryCode): readonly CategoryNode[] {
  return TAXONOMY[code];
}

export function findCategory(id: string): CategoryNode | undefined {
  return CATEGORY_INDEX.get(id)?.node;
}

/** The country whose taxonomy has this category (or subcategory). */
export function countryOfCategory(id: string): CountryCode | undefined {
  return CATEGORY_INDEX.get(id)?.country ?? SUBCATEGORY_INDEX.get(id)?.country;
}

export function isCategory(id: string): boolean {
  return CATEGORY_INDEX.has(id);
}

export function isSubcategoryOf(category: Category, subcategory: string): boolean {
  return SUBCATEGORY_INDEX.get(subcategory)?.parent.id === category;
}

/** The subcategory's category, if the id is a subcategory. */
export function parentOf(subcategory: string): Category | undefined {
  return SUBCATEGORY_INDEX.get(subcategory)?.parent.id;
}

export function subcategoriesOf(category: Category): readonly Subcategory[] {
  return (findCategory(category)?.children ?? []).map((c) => c.id);
}

function merge(defs: Iterable<AttributeDef>): AttributeDef[] {
  const out = new Map<string, AttributeDef>();
  for (const d of defs) if (!out.has(d.key)) out.set(d.key, d);
  return [...out.values()];
}

/**
 * The attributes of a listing in a subcategory: its category's, then its own. Without a subcategory,
 * every attribute any subcategory of the category has (what a filter sidebar for the category offers),
 * with the subcategory-only ones optional.
 */
export function attributesOf(category: Category, subcategory?: Subcategory): AttributeDef[] {
  const root = findCategory(category);
  if (!root) return [];
  if (subcategory !== undefined) {
    const sub = isSubcategoryOf(category, subcategory)
      ? SUBCATEGORY_INDEX.get(subcategory)!.node
      : undefined;
    return merge([...(root.attributes ?? []), ...(sub?.attributes ?? [])]);
  }
  const children = root.children ?? [];
  const inAll = (key: string) => children.every((c) => c.attributes?.some((a) => a.key === key));
  return merge([
    ...(root.attributes ?? []),
    ...children.flatMap((c) =>
      (c.attributes ?? []).map((a) => (inAll(a.key) ? a : { ...a, required: false })),
    ),
  ]);
}

export function priceRuleOf(category: Category, subcategory?: Subcategory): PriceRule {
  const sub = subcategory ? SUBCATEGORY_INDEX.get(subcategory)?.node : undefined;
  return sub?.price ?? findCategory(category)?.price ?? 'required';
}

export function priceUnitOf(category: Category, subcategory?: Subcategory): PriceUnit | undefined {
  const sub = subcategory ? SUBCATEGORY_INDEX.get(subcategory)?.node : undefined;
  return sub?.priceUnit ?? findCategory(category)?.priceUnit;
}

/** Attributes searchable as multi-value filters in a category (or subcategory). */
export function facetsOf(category: Category, subcategory?: Subcategory): AttributeDef[] {
  return attributesOf(category, subcategory).filter((a) => a.facet);
}

/** Range filters of a category (or subcategory): the query parameter and the attribute it filters. */
export function rangesOf(
  category: Category,
  subcategory?: Subcategory,
): Array<{ param: string; field: string; unit?: string }> {
  return attributesOf(category, subcategory).flatMap((a) =>
    a.kind === 'number' && a.range ? [{ param: a.range, field: a.key, unit: a.unit }] : [],
  );
}

/**
 * Every attribute of every taxonomy by key, select options merged. One key has one kind everywhere
 * (a unit test checks it), so the index maps it once.
 */
export const ALL_ATTRIBUTES: ReadonlyMap<string, AttributeDef> = (() => {
  const out = new Map<string, AttributeDef>();
  const all = Object.values(TAXONOMY).flatMap((roots) =>
    roots.flatMap((r) => [
      ...(r.attributes ?? []),
      ...(r.children ?? []).flatMap((c) => c.attributes ?? []),
    ]),
  );
  for (const def of all) {
    const seen = out.get(def.key);
    if (!seen) out.set(def.key, def);
    else if (seen.kind === 'select' && def.kind === 'select') {
      out.set(def.key, { ...seen, options: [...new Set([...seen.options, ...def.options])] });
    }
  }
  return out;
})();

/** Keys of all facet attributes (search parameters of the same name). */
export const FACET_KEYS: readonly string[] = [...ALL_ATTRIBUTES.values()]
  .filter((a) => a.facet)
  .map((a) => a.key);

/** Range parameters of all taxonomies and the attribute each filters. */
export const RANGE_FIELDS: Readonly<Record<string, string>> = Object.fromEntries(
  [...ALL_ATTRIBUTES.values()].flatMap((a) =>
    a.kind === 'number' && a.range ? [[a.range, a.key] as const] : [],
  ),
);
export const RANGE_PARAMS: readonly string[] = Object.keys(RANGE_FIELDS);
