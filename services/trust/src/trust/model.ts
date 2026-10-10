import { z } from 'zod';

export type Role = 'buyer' | 'seller';

export interface ListingRow {
  id: string;
  owner_id: string;
  title: string;
  status: 'active' | 'sold' | 'deleted';
  sold_at: Date | null;
  version: number;
}

export interface ReviewRow {
  id: string;
  listing_id: string;
  listing_title: string;
  reviewer_id: string;
  reviewer_name: string;
  subject_id: string;
  subject_role: Role;
  rating: number;
  comment: string;
  created_at: Date;
  removed_at: Date | null;
  removed_by: 'author' | 'moderator' | null;
}

export interface VerificationRow {
  user_id: string;
  method: 'bankid';
  verified_at: Date;
}

/** What the database knows about a possible deal between two people. */
export interface DealFacts {
  listing: ListingRow | null;
  reviewerWrote: boolean;
  subjectWrote: boolean;
  alreadyReviewed: boolean;
}

export type IneligibleReason =
  | 'self'
  | 'unknown_listing'
  | 'not_party'
  | 'no_conversation'
  | 'not_sold'
  | 'window_closed'
  | 'already_reviewed';

export type Eligibility =
  | { canReview: true; subjectRole: Role; deadline: string }
  | { canReview: false; reason: IneligibleReason };

/**
 * Who may review whom (ADR-0018): the seller and a buyer who both wrote in a
 * conversation about the listing, once it is sold, for `windowDays` after the
 * sale, once per direction. Pure, so the rules are unit tested.
 */
export function decideEligibility(
  reviewerId: string,
  subjectId: string,
  facts: DealFacts,
  now: Date,
  windowDays: number,
): Eligibility {
  if (reviewerId === subjectId) return { canReview: false, reason: 'self' };
  const { listing } = facts;
  if (!listing) return { canReview: false, reason: 'unknown_listing' };
  const reviewerIsSeller = listing.owner_id === reviewerId;
  const subjectIsSeller = listing.owner_id === subjectId;
  if (reviewerIsSeller === subjectIsSeller) return { canReview: false, reason: 'not_party' };
  if (!facts.reviewerWrote || !facts.subjectWrote) {
    return { canReview: false, reason: 'no_conversation' };
  }
  if (!listing.sold_at) return { canReview: false, reason: 'not_sold' };
  const deadline = new Date(listing.sold_at.getTime() + windowDays * 86_400_000);
  if (now > deadline) return { canReview: false, reason: 'window_closed' };
  if (facts.alreadyReviewed) return { canReview: false, reason: 'already_reviewed' };
  return {
    canReview: true,
    subjectRole: subjectIsSeller ? 'seller' : 'buyer',
    deadline: deadline.toISOString(),
  };
}

export interface RatingSummary {
  /** Mean of the visible ratings, one decimal; null without reviews. */
  average: number | null;
  count: number;
  /** Number of 1- to 5-star ratings, index 0 = one star. */
  distribution: [number, number, number, number, number];
}

export function summarise(counts: Array<{ rating: number; n: number }>): RatingSummary {
  const distribution: RatingSummary['distribution'] = [0, 0, 0, 0, 0];
  for (const { rating, n } of counts) distribution[rating - 1] = n;
  const count = distribution.reduce((a, b) => a + b, 0);
  const total = distribution.reduce((sum, n, i) => sum + n * (i + 1), 0);
  return { average: count ? Math.round((total / count) * 10) / 10 : null, count, distribution };
}

export interface Review {
  id: string;
  rating: number;
  comment: string;
  /** What the reviewed person was in the deal. */
  subjectRole: Role;
  listing: { id: string; title: string };
  reviewer: { id: string; name: string };
  createdAt: string;
}

export function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    subjectRole: row.subject_role,
    listing: { id: row.listing_id, title: row.listing_title },
    reviewer: { id: row.reviewer_id, name: row.reviewer_name },
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * A review on the caller's own reviews page (ADR-0055), from their side of the deal: `other` is the
 * person reviewed (given) or the reviewer (received), with their role in the deal and their display
 * name when trust knows it.
 */
export interface MyReview {
  id: string;
  rating: number;
  comment: string;
  listing: { id: string; title: string };
  other: { id: string; name: string | null; role: Role };
  createdAt: string;
}

/** A finished deal the caller may still review (the same rules as decideEligibility). */
export interface PendingReview {
  listing: { id: string; title: string };
  other: { id: string; name: string | null; role: Role };
  soldAt: string;
  deadline: string;
}

const otherRole = (role: Role): Role => (role === 'buyer' ? 'seller' : 'buyer');

/** A review the caller gave: the other person is the one reviewed. */
export function givenReview(row: ReviewRow & { subject_name: string | null }): MyReview {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    listing: { id: row.listing_id, title: row.listing_title },
    other: { id: row.subject_id, name: row.subject_name, role: row.subject_role },
    createdAt: row.created_at.toISOString(),
  };
}

/** A review about the caller: the other person is the reviewer, on the other side of the deal. */
export function receivedReview(row: ReviewRow): MyReview {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    listing: { id: row.listing_id, title: row.listing_title },
    other: { id: row.reviewer_id, name: row.reviewer_name, role: otherRole(row.subject_role) },
    createdAt: row.created_at.toISOString(),
  };
}

export interface PendingRow {
  listing_id: string;
  listing_title: string;
  sold_at: Date;
  other_id: string;
  other_name: string | null;
  other_is_seller: boolean;
}

export function pendingReview(row: PendingRow, windowDays: number): PendingReview {
  return {
    listing: { id: row.listing_id, title: row.listing_title },
    other: {
      id: row.other_id,
      name: row.other_name,
      role: row.other_is_seller ? 'seller' : 'buyer',
    },
    soldAt: row.sold_at.toISOString(),
    deadline: new Date(row.sold_at.getTime() + windowDays * 86_400_000).toISOString(),
  };
}

export const myReviewsQuerySchema = z.object({
  direction: z.enum(['received', 'given']).default('received'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export interface Verification {
  method: 'bankid';
  verifiedAt: string;
}

export function toVerification(row: VerificationRow | null): Verification | null {
  return row ? { method: row.method, verifiedAt: row.verified_at.toISOString() } : null;
}

/** Shown when the service has never seen a user's public name. */
export const UNKNOWN_NAME = 'Raadi-bruker';

const uuid = z.uuid();

export const reviewBodySchema = z
  .object({
    listingId: uuid,
    subjectId: uuid,
    rating: z.number().int().min(1).max(5),
    comment: z
      .string()
      .trim()
      .max(1000)
      // eslint-disable-next-line no-control-regex -- control characters (except newlines) are rejected
      .refine((s) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s), 'Invalid characters')
      .default(''),
  })
  .strict();

export const eligibilityQuerySchema = z.object({ listingId: uuid, subjectId: uuid });

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/**
 * Only same-site relative paths are allowed as redirect targets after
 * verification (no open redirects such as "//evil.com" or "/\\evil.com").
 */
export function safeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex -- deliberately rejects control characters (header/URL injection)
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'http://raadi.invalid');
    return url.host === 'raadi.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** Appends `verification=<outcome>` to a relative return path. */
export function withOutcome(returnTo: string, outcome: VerificationOutcome): string {
  const [path, hash] = returnTo.split('#', 2) as [string, string | undefined];
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}verification=${outcome}${hash ? `#${hash}` : ''}`;
}

export type VerificationOutcome = 'ok' | 'cancelled' | 'taken' | 'expired' | 'failed';
