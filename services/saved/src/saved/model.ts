import { type Money, regionName, SAVED_SEARCH_EXCLUDED, searchParamsSchema } from '@raadi/catalog';
import { imageUrls, type ImgproxySigner } from '@raadi/service-kit';
import { z } from 'zod';

export interface ListingRow {
  id: string;
  version: number;
  owner_id: string | null;
  status: 'active' | 'sold' | 'deleted';
  category: string;
  subcategory: string;
  title: string;
  country: string;
  price_minor: string | number | null;
  currency: string | null;
  image_id: string | null;
  place_name: string;
  region: string;
  published_at: Date;
}

export interface FavouriteRow extends ListingRow {
  favourited_at: Date;
}

export interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string;
  params: Record<string, string>;
  notify: boolean;
  new_count: number;
  checked_until: Date;
  next_run_at: Date;
  created_at: Date;
}

export interface Favourite {
  listingId: string;
  savedAt: string;
  listing: {
    id: string;
    title: string;
    country: string;
    price: Money | null;
    status: 'active' | 'sold' | 'deleted';
    category: string;
    subcategory: string;
    location: { name: string; region: string; regionName: string };
    image?: { thumb: string; card: string };
    publishedAt: string;
  };
}

export interface SavedSearch {
  id: string;
  name: string;
  /** The search API's query parameters (no paging or sorting). */
  params: Record<string, string>;
  notify: boolean;
  /** New listings found since the user last opened this search. */
  newCount: number;
  createdAt: string;
}

/** The stored price as money, or null. */
export function priceOf(row: Pick<ListingRow, 'price_minor' | 'currency'>): Money | null {
  return row.price_minor === null || row.currency === null
    ? null
    : { amountMinor: Number(row.price_minor), currency: row.currency };
}

export function toFavourite(row: FavouriteRow, signer: ImgproxySigner): Favourite {
  const image = row.image_id ? imageUrls(signer, row.image_id) : undefined;
  return {
    listingId: row.id,
    savedAt: row.favourited_at.toISOString(),
    listing: {
      id: row.id,
      title: row.title,
      country: row.country,
      price: priceOf(row),
      status: row.status,
      category: row.category,
      subcategory: row.subcategory,
      location: {
        name: row.place_name,
        region: row.region,
        regionName: regionName(row.region),
      },
      ...(image ? { image: { thumb: image.thumb, card: image.card } } : {}),
      publishedAt: row.published_at.toISOString(),
    },
  };
}

export function toSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    params: row.params,
    notify: row.notify,
    newCount: row.new_count,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * A search to save: the search API's own parameters, validated by the same schema search uses.
 * Paging, sorting and time windows are dropped, empty values removed, keys sorted, so one search
 * saved twice is one row.
 */
export const searchQuerySchema = z
  .record(z.string().max(40), z.string().max(400))
  .refine((q) => Object.keys(q).length <= 40, 'too many parameters')
  .transform((q) =>
    Object.fromEntries(
      Object.entries(q)
        .filter(([k, v]) => !SAVED_SEARCH_EXCLUDED.includes(k) && v.trim() !== '')
        .map(([k, v]) => [k, v.trim()] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  )
  .superRefine((q, ctx) => {
    const parsed = searchParamsSchema.safeParse(q);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path.map(String), message: issue.message });
    }
  });

export const createSavedSearchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    params: searchQuerySchema,
    notify: z.boolean().default(true),
  })
  .strict();

export const updateSavedSearchSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), notify: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.notify !== undefined, 'nothing to change');

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(48),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export type CreateSavedSearch = z.infer<typeof createSavedSearchSchema>;
export type UpdateSavedSearch = z.infer<typeof updateSavedSearchSchema>;
