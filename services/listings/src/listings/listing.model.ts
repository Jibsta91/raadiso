import {
  attributeSchemas,
  categorySchema,
  findPlace,
  isSubcategoryOf,
  priceRequired,
  type Category,
} from '@raadi/catalog';
import type { ListingSnapshot } from '@raadi/events';
import { imageUrls, type ImgproxySigner } from '@raadi/service-kit';
import { z } from 'zod';

export type ListingStatus = 'active' | 'sold' | 'deleted';

const fields = {
  category: categorySchema,
  subcategory: z.string().min(1).max(40),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(5000),
  priceNok: z.number().int().min(0).max(10_000_000_000).nullable(),
  attributes: z.record(z.string(), z.unknown()),
  placeId: z.string().min(1).max(40),
  imageIds: z.array(z.uuid()).max(10),
};

/**
 * Cross-field rules shared by create and update: the subcategory belongs to
 * the category, attributes match the category, jobs have no price and every
 * other category has one, the place exists, and images are unique.
 */
function validateListing(v: z.infer<z.ZodObject<typeof fields>>, ctx: z.RefinementCtx): void {
  if (!isSubcategoryOf(v.category, v.subcategory)) {
    ctx.addIssue({
      code: 'custom',
      path: ['subcategory'],
      message: `not a subcategory of ${v.category}`,
    });
  }
  const attrs = attributeSchemas[v.category].safeParse(v.attributes);
  if (!attrs.success) {
    for (const issue of attrs.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['attributes', ...issue.path.map(String)],
        message: issue.message,
      });
    }
  }
  if (priceRequired(v.category) && v.priceNok === null) {
    ctx.addIssue({ code: 'custom', path: ['priceNok'], message: 'a price is required' });
  }
  if (!priceRequired(v.category) && v.priceNok !== null) {
    ctx.addIssue({ code: 'custom', path: ['priceNok'], message: 'job listings have no price' });
  }
  if (!findPlace(v.placeId))
    ctx.addIssue({ code: 'custom', path: ['placeId'], message: 'unknown place' });
  if (new Set(v.imageIds).size !== v.imageIds.length) {
    ctx.addIssue({ code: 'custom', path: ['imageIds'], message: 'duplicate image' });
  }
}

export const createListingSchema = z
  .object({
    ...fields,
    priceNok: fields.priceNok.default(null),
    imageIds: fields.imageIds.default([]),
  })
  .strict()
  .superRefine(validateListing);

export type CreateListing = z.infer<typeof createListingSchema>;

/** PATCH body: any subset of the fields, plus the status (mark as sold / relist). */
export const updateListingSchema = z
  .object({
    ...Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.optional()])),
    status: z.enum(['active', 'sold']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field') as z.ZodType<
  Partial<CreateListing> & { status?: 'active' | 'sold' }
>;

export type UpdateListing = z.infer<typeof updateListingSchema>;

/** Validates the result of applying a PATCH to the stored listing. */
export const mergedListingSchema = z.object(fields).superRefine(validateListing);

/** Why a moderator removed a listing (ADR-0030). */
export const REMOVAL_REASONS = [
  'fraud',
  'prohibited',
  'offensive',
  'wrong_category',
  'duplicate',
  'spam',
  'other',
] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export interface ListingRow {
  id: string;
  owner_id: string;
  seller_name: string;
  category: Category;
  subcategory: string;
  title: string;
  description: string;
  price_nok: string | null; // bigint arrives as a string
  attributes: Record<string, string | number | boolean>;
  place_id: string;
  lat: number;
  lon: number;
  image_ids: string[];
  status: ListingStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
  published_at: Date;
  /** End of a paid promotion (ADR-0020); in the past or null when not promoted. */
  promoted_until: Date | null;
  removed_by: 'owner' | 'moderation' | null;
  removal_reason: RemovalReason | null;
}

export interface ListingImage {
  id: string;
  urls: { thumb: string; card: string; large: string };
}

export interface Listing {
  id: string;
  version: number;
  status: ListingStatus;
  category: Category;
  subcategory: string;
  title: string;
  description: string;
  priceNok: number | null;
  attributes: Record<string, string | number | boolean>;
  location: { placeId: string; name: string; county: string; lat: number; lon: number };
  images: ListingImage[];
  seller: { name: string };
  publishedAt: string;
  updatedAt: string;
  /** Set while a paid promotion runs. */
  promotedUntil: string | null;
  /** Present when the caller is authenticated. */
  viewer?: { isOwner: boolean; canEdit: boolean; canDelete: boolean };
  /** Only on the owner's list of their listings: a moderator removed it (and why). */
  removal?: { reason: RemovalReason | null };
}

function location(row: ListingRow) {
  const place = findPlace(row.place_id);
  return {
    placeId: row.place_id,
    name: place?.name ?? row.place_id,
    county: place?.county ?? 'unknown',
    lat: row.lat,
    lon: row.lon,
  };
}

export function toListing(row: ListingRow, signer: ImgproxySigner): Listing {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    category: row.category,
    subcategory: row.subcategory,
    title: row.title,
    description: row.description,
    priceNok: row.price_nok === null ? null : Number(row.price_nok),
    attributes: row.attributes,
    location: location(row),
    images: row.image_ids.map((id) => ({ id, urls: imageUrls(signer, id) })),
    seller: { name: row.seller_name },
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    promotedUntil: activePromotion(row),
    ...(row.status === 'deleted' && row.removed_by === 'moderation'
      ? { removal: { reason: row.removal_reason } }
      : {}),
  };
}

/** The promotion end while it is still running, else null. */
export function activePromotion(row: ListingRow, now = new Date()): string | null {
  return row.promoted_until && row.promoted_until > now ? row.promoted_until.toISOString() : null;
}

/** Event payload: public listing state, no seller name (ids, not personal data). */
export function toSnapshot(row: ListingRow): ListingSnapshot {
  return {
    id: row.id,
    version: row.version,
    ownerId: row.owner_id,
    status: row.status,
    category: row.category,
    subcategory: row.subcategory,
    title: row.title,
    description: row.description,
    priceNok: row.price_nok === null ? null : Number(row.price_nok),
    attributes: row.attributes,
    location: location(row),
    imageIds: row.image_ids,
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    promotedUntil: row.promoted_until?.toISOString() ?? null,
  };
}
