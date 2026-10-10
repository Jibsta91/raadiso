import {
  attributeSchema,
  categorySchema,
  COUNTRIES,
  countryOfCategory,
  findPlace,
  isSubcategoryOf,
  priceRuleOf,
  type Category,
  type CountryCode,
  type Money,
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
  /** Minor units of the country's currency (ADR-0040); null when there is no asking price. */
  price: z
    .object({
      amountMinor: z.number().int().min(0).max(1_000_000_000_000_000),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict()
    .nullable(),
  attributes: z.record(z.string(), z.unknown()),
  placeId: z.string().min(1).max(40),
  imageIds: z.array(z.uuid()).max(10),
};

/**
 * Cross-field rules shared by create and update (ADR-0040): the place exists and decides the country,
 * the category belongs to that country's taxonomy and the subcategory to the category, the attributes
 * match the subcategory, the price follows the category's rule and is in the country's currency, and
 * images are unique.
 */
function validateListing(v: z.infer<z.ZodObject<typeof fields>>, ctx: z.RefinementCtx): void {
  const place = findPlace(v.placeId);
  if (!place) ctx.addIssue({ code: 'custom', path: ['placeId'], message: 'unknown place' });
  if (place && countryOfCategory(v.category) !== place.country) {
    ctx.addIssue({
      code: 'custom',
      path: ['category'],
      message: `not a category in ${place.country}`,
    });
  }
  if (!isSubcategoryOf(v.category, v.subcategory)) {
    ctx.addIssue({
      code: 'custom',
      path: ['subcategory'],
      message: `not a subcategory of ${v.category}`,
    });
  }
  const attrs = attributeSchema(v.category, v.subcategory).safeParse(v.attributes);
  if (!attrs.success) {
    for (const issue of attrs.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['attributes', ...issue.path.map(String)],
        message: issue.message,
      });
    }
  }
  const rule = priceRuleOf(v.category, v.subcategory);
  if (rule === 'required' && v.price === null) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'a price is required' });
  }
  if (rule === 'none' && v.price !== null) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'this category has no price' });
  }
  if (place && v.price && v.price.currency !== COUNTRIES[place.country].currency) {
    ctx.addIssue({
      code: 'custom',
      path: ['price', 'currency'],
      message: `prices in ${place.country} are in ${COUNTRIES[place.country].currency}`,
    });
  }
  if (new Set(v.imageIds).size !== v.imageIds.length) {
    ctx.addIssue({ code: 'custom', path: ['imageIds'], message: 'duplicate image' });
  }
}

export const createListingSchema = z
  .object({
    ...fields,
    price: fields.price.default(null),
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
  country: CountryCode;
  price_minor: string | null; // bigint arrives as a string
  currency: string | null;
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
  /** The last drop (ADR-0044): the price before it, and when; null once the price goes up again. */
  previous_price_minor: string | null;
  price_dropped_at: Date | null;
  /** Seller tools (ADR-0045): views counted, and when the owner last renewed it. */
  views: number;
  renewed_at: Date | null;
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
  country: CountryCode;
  price: Money | null;
  attributes: Record<string, string | number | boolean>;
  location: { placeId: string; name: string; region: string; lat: number; lon: number };
  images: ListingImage[];
  seller: { name: string };
  publishedAt: string;
  updatedAt: string;
  /** Set while a paid promotion runs. */
  promotedUntil: string | null;
  /** The listing's last price drop, until the price goes up again (ADR-0044). */
  priceDrop?: { previous: Money; at: string };
  /** For the owner only (ADR-0045): views, and from when it can be renewed. */
  stats?: { views: number; renewableAt: string; favourites?: number };
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
    region: place?.region ?? 'unknown',
    lat: row.lat,
    lon: row.lon,
  };
}

/** The stored price as money, or null. */
export function priceOf(row: Pick<ListingRow, 'price_minor' | 'currency'>): Money | null {
  return row.price_minor === null || row.currency === null
    ? null
    : { amountMinor: Number(row.price_minor), currency: row.currency };
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
    country: row.country,
    price: priceOf(row),
    attributes: row.attributes,
    location: location(row),
    images: row.image_ids.map((id) => ({ id, urls: imageUrls(signer, id) })),
    seller: { name: row.seller_name },
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    promotedUntil: activePromotion(row),
    ...(dropOf(row) ? { priceDrop: dropOf(row)! } : {}),
    ...(row.status === 'deleted' && row.removed_by === 'moderation'
      ? { removal: { reason: row.removal_reason } }
      : {}),
  };
}

/**
 * The owner's numbers (ADR-0045): views, from when the listing can be renewed, and how many people
 * saved it when the saved service answered (`hearts`; a listing nobody saved counts 0).
 */
export function ownerStats(
  row: ListingRow,
  renewAfterDays: number,
  hearts?: Readonly<Record<string, number>>,
) {
  return {
    views: row.views,
    renewableAt: new Date(row.published_at.getTime() + renewAfterDays * 86_400_000).toISOString(),
    ...(hearts ? { favourites: hearts[row.id] ?? 0 } : {}),
  };
}

/** The last price drop, if the listing has one (ADR-0044). */
export function dropOf(row: ListingRow): { previous: Money; at: string } | null {
  return row.previous_price_minor !== null && row.price_dropped_at && row.currency
    ? {
        previous: { amountMinor: Number(row.previous_price_minor), currency: row.currency },
        at: row.price_dropped_at.toISOString(),
      }
    : null;
}

/** The promotion end while it is still running, else null. */
export function activePromotion(row: ListingRow, now = new Date()): string | null {
  return row.promoted_until && row.promoted_until > now ? row.promoted_until.toISOString() : null;
}

/**
 * Event payload: public listing state, no seller name (ids, not personal data). `priceNok` and
 * `location.county` stay for consumers that predate ADR-0040.
 */
export function toSnapshot(row: ListingRow): ListingSnapshot {
  const price = priceOf(row);
  const where = location(row);
  return {
    id: row.id,
    version: row.version,
    ownerId: row.owner_id,
    status: row.status,
    category: row.category,
    subcategory: row.subcategory,
    title: row.title,
    description: row.description,
    priceNok: price?.currency === 'NOK' ? Math.floor(price.amountMinor / 100) : null,
    price,
    country: row.country,
    attributes: row.attributes,
    location: {
      placeId: where.placeId,
      name: where.name,
      county: where.region,
      region: where.region,
      lat: where.lat,
      lon: where.lon,
    },
    imageIds: row.image_ids,
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    promotedUntil: row.promoted_until?.toISOString() ?? null,
    priceDrop: dropOf(row),
  };
}
