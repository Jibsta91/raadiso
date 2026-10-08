import { z } from 'zod';
import { ALL_ATTRIBUTES, CATEGORY_KEYS, FACET_KEYS, RANGE_PARAMS } from './categories.js';
import { COUNTRY_CODES } from './countries.js';
import { findPlace, REGION_KEYS } from './places.js';

/**
 * The search API's query parameters (GET /api/v1/search/listings), shared by the search service and the
 * services that store searches (saved searches, ADR-0026). Facet and range parameters are generated from
 * the taxonomy (ADR-0040): every facet attribute is a parameter of the same name, every range attribute
 * gives `<range>Min` and `<range>Max`.
 */
const count = z.coerce.number().int().min(0).max(10_000_000);

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values as [T, ...T[]])).max(values.length));

/** Free-text facet values (car makes), matched case-insensitively: the index lower-cases them. */
const lowerCsv = z
  .string()
  .trim()
  .max(400)
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().max(40)).max(20));

const facetParams = Object.fromEntries(
  FACET_KEYS.map((key) => {
    const def = ALL_ATTRIBUTES.get(key)!;
    return [key, (def.kind === 'select' ? csv(def.options) : lowerCsv).optional()];
  }),
) as Record<string, z.ZodOptional<z.ZodType<string[]>>>;

const rangeParams = Object.fromEntries(
  RANGE_PARAMS.flatMap((p) => [
    [`${p}Min`, count.optional()],
    [`${p}Max`, count.optional()],
  ]),
) as Record<string, z.ZodOptional<typeof count>>;

/** Query string of GET /api/v1/search/listings. Multi-value facets are comma-separated. */
const schema = z
  .object({
    /** The marketplace searched; the service's default country when absent. */
    country: z.enum(COUNTRY_CODES as [string, ...string[]]).optional(),
    q: z.string().trim().max(200).optional(),
    /** "false" searches the words as typed, without reading categories, places and prices into them. */
    understand: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    category: csv(CATEGORY_KEYS).optional(),
    subcategory: z
      .string()
      .trim()
      .max(400)
      .transform((s) => s.split(',').filter(Boolean))
      .optional(),
    region: csv(REGION_KEYS).optional(),
    ...facetParams,
    ...rangeParams,
    /** Major units of the country's currency, as people type them. */
    priceMin: z.coerce.number().min(0).max(1e12).optional(),
    priceMax: z.coerce.number().min(0).max(1e12).optional(),
    /** Centre of a radius search: a place id from the gazetteer, or lat+lon (e.g. the browser's position). */
    near: z.string().max(40).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(1).max(2000).optional(),
    /**
     * Only listings published in this window (exclusive start, inclusive end). Used by saved
     * searches to find new matches (ADR-0026).
     */
    publishedAfter: z.iso.datetime({ offset: true }).optional(),
    publishedBefore: z.iso.datetime({ offset: true }).optional(),
    sort: z
      .enum(['relevance', 'newest', 'price_asc', 'price_desc', 'distance'])
      .default('relevance'),
    page: z.coerce.number().int().min(1).max(200).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(24),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.near && !findPlace(p.near))
      ctx.addIssue({ code: 'custom', path: ['near'], message: 'unknown place' });
    if ((p.lat === undefined) !== (p.lon === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'lat and lon go together' });
    }
    const range = p as unknown as Record<string, number | undefined>;
    for (const name of ['price', ...RANGE_PARAMS]) {
      const min = range[`${name}Min`];
      const max = range[`${name}Max`];
      if (min !== undefined && max !== undefined && min > max) {
        ctx.addIssue({
          code: 'custom',
          path: [`${name}Min`],
          message: `${name}Min is above ${name}Max`,
        });
      }
    }
    if (p.sort === 'distance' && !p.near && p.lat === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sort'],
        message: 'distance sorting needs near or lat/lon',
      });
    }
  });

/**
 * Parsed parameters. The fixed ones are typed; the generated facets (string arrays) and ranges
 * (numbers) are looked up by name.
 */
export type SearchParams = z.infer<typeof schema> & {
  readonly [param: string]: string[] | number | string | undefined;
};

/** Every parameter name the search API accepts (for the OpenAPI contract test). */
export const SEARCH_PARAM_NAMES: readonly string[] = Object.keys(schema.shape);

export const searchParamsSchema = schema as unknown as z.ZodType<
  SearchParams,
  Record<string, unknown>
>;

/** Parameters that describe what to find (not how to page or sort): what a saved search keeps. */
export const SAVED_SEARCH_EXCLUDED = [
  'page',
  'pageSize',
  'sort',
  'publishedAfter',
  'publishedBefore',
];
