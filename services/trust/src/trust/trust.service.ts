import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { parseEvent } from '@raadi/events';
import { displayName, type Principal } from '@raadi/service-kit';
import { PermanentEventError, type ReceivedEvent } from '@raadi/service-kit/kafka';
import type { z } from 'zod';
import type { AppConfig } from '../config.js';
import { APP_CONFIG } from '../tokens.js';
import { BankIdClient } from './bankid.js';
import { ListingsClient } from './listings.client.js';
import {
  decideEligibility,
  type Eligibility,
  type reviewBodySchema,
  safeReturnTo,
  summarise,
  toReview,
  toVerification,
  UNKNOWN_NAME,
  type VerificationOutcome,
  withOutcome,
} from './model.js';
import { TrustRepository, UniqueViolation } from './trust.repository.js';

const meter = metrics.getMeter('trust');
const reviewsCounter = meter.createCounter('raadi.trust.reviews', {
  description:
    'Review attempts by outcome (published, rejected, removed_by_author, removed_by_moderator)',
});
const verificationsCounter = meter.createCounter('raadi.trust.verifications', {
  description: 'Identity verifications by outcome (ok, cancelled, taken, expired, failed)',
});

/** A verification redirect is valid for this long. */
const REQUEST_TTL_MS = 10 * 60_000;

/** Roles that may remove other people's reviews. */
const MODERATORS = ['moderator', 'platform-admin'];

@Injectable()
export class TrustService {
  private readonly logger = new Logger(TrustService.name);

  constructor(
    private readonly repo: TrustRepository,
    private readonly bankid: BankIdClient,
    private readonly listings: ListingsClient,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------------------------------------------------------------- events

  /** Keeps the listing and contact projections up to date (exactly once per event). */
  async onEvent(event: ReceivedEvent): Promise<void> {
    let parsed;
    try {
      parsed = parseEvent(event.value);
    } catch (error) {
      throw new PermanentEventError('event violates its contract', { cause: error });
    }
    if (!parsed) return; // a newer event type this build does not know

    switch (parsed.type) {
      case 'no.raadi.listings.listing.published.v1':
      case 'no.raadi.listings.listing.updated.v1': {
        const { listing } = parsed.data;
        await this.repo.once(parsed.id, async (tx) => {
          await this.repo.applyListing(tx, listing);
        });
        return;
      }
      case 'no.raadi.listings.listing.deleted.v1': {
        const { listingId, version } = parsed.data;
        await this.repo.once(parsed.id, (tx) =>
          this.repo.markListingDeleted(tx, listingId, version),
        );
        return;
      }
      case 'no.raadi.messaging.conversation.message_sent.v1': {
        const { listingId, senderId, recipientId, sentAt } = parsed.data;
        await this.repo.once(parsed.id, (tx) =>
          this.repo.recordContact(tx, listingId, senderId, recipientId, sentAt),
        );
        return;
      }
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- reviews

  async eligibility(
    principal: Principal,
    listingId: string,
    subjectId: string,
  ): Promise<Eligibility> {
    const facts = await this.repo.dealFacts(listingId, principal.sub, subjectId);
    return decideEligibility(
      principal.sub,
      subjectId,
      facts,
      new Date(),
      this.cfg.env.REVIEW_WINDOW_DAYS,
    );
  }

  /** `token` is the caller's bearer token, forwarded to listings for the seller's name. */
  async createReview(principal: Principal, token: string, body: z.infer<typeof reviewBodySchema>) {
    try {
      const row = await this.repo.createReview(
        {
          listingId: body.listingId,
          reviewerId: principal.sub,
          reviewerName: displayName(principal.claims),
          subjectId: body.subjectId,
          rating: body.rating,
          comment: body.comment,
        },
        (facts) => {
          const decision = decideEligibility(
            principal.sub,
            body.subjectId,
            facts,
            new Date(),
            this.cfg.env.REVIEW_WINDOW_DAYS,
          );
          if (!decision.canReview) {
            reviewsCounter.add(1, { outcome: 'rejected', reason: decision.reason });
            if (decision.reason === 'already_reviewed') {
              throw new ConflictException('You have already reviewed this deal');
            }
            throw new UnprocessableEntityException(`Not eligible to review: ${decision.reason}`);
          }
          return { listingTitle: facts.listing!.title, subjectRole: decision.subjectRole };
        },
      );
      reviewsCounter.add(1, { outcome: 'published' });
      if (row.subject_role === 'seller') {
        const seller = await this.listings.seller(row.listing_id, token);
        if (seller?.ownerId === row.subject_id) {
          await this.repo.rememberName(row.subject_id, seller.sellerName);
        }
      }
      return toReview(row);
    } catch (error) {
      if (error instanceof UniqueViolation) {
        throw new ConflictException('You have already reviewed this deal');
      }
      throw error;
    }
  }

  /** Authors may withdraw their review; moderators may remove any review. */
  async removeReview(principal: Principal, id: string): Promise<void> {
    const review = await this.repo.review(id);
    if (!review || review.removed_at) throw new NotFoundException('Review not found');
    const isAuthor = review.reviewer_id === principal.sub;
    const isModerator = principal.roles.some((r) => MODERATORS.includes(r));
    if (!isAuthor && !isModerator) throw new ForbiddenException('Not your review');
    const by = isAuthor ? 'author' : 'moderator';
    // A moderator's removal is a staff action: audited in the same transaction (ADR-0028).
    await this.repo.removeReview(id, by, isAuthor ? undefined : principal);
    reviewsCounter.add(1, { outcome: `removed_by_${by}` });
    if (!isAuthor)
      this.logger.log({ reviewId: id, moderator: principal.sub }, 'review removed by moderator');
  }

  // ---------------------------------------------------------------- profiles

  /** Public trust profile: name, verification, rating summary and a page of reviews. */
  async profile(userId: string, limit: number, offset: number) {
    const [name, verification, reviews] = await Promise.all([
      this.repo.name(userId),
      this.repo.verification(userId),
      this.repo.reviewsAbout(userId, limit, offset),
    ]);
    const rating = summarise(reviews.counts);
    // Sellers without reviews have a profile too: listing pages link to it.
    if (!name && !verification && rating.count === 0 && !(await this.repo.hasListings(userId)))
      throw new NotFoundException('User not found');
    return {
      userId,
      name: name ?? UNKNOWN_NAME,
      verification: toVerification(verification),
      rating,
      reviews: { total: rating.count, limit, offset, items: reviews.rows.map(toReview) },
    };
  }

  /** The seller of a listing, for the listing page (listings never expose owner ids). */
  async sellerOf(listingId: string) {
    const listing = await this.repo.listing(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    const [name, verification, counts] = await Promise.all([
      this.repo.name(listing.owner_id),
      this.repo.verification(listing.owner_id),
      this.repo.ratingCounts(listing.owner_id),
    ]);
    return {
      userId: listing.owner_id,
      name: name ?? UNKNOWN_NAME,
      verification: toVerification(verification),
      rating: summarise(counts),
    };
  }

  /** The caller's own trust status (also records their current display name). */
  async me(principal: Principal) {
    const name = displayName(principal.claims);
    const [verification, counts] = await Promise.all([
      this.repo.verification(principal.sub),
      this.repo.ratingCounts(principal.sub),
      this.repo.rememberName(principal.sub, name),
    ]);
    return {
      userId: principal.sub,
      name,
      verification: toVerification(verification),
      rating: summarise(counts),
    };
  }

  // ---------------------------------------------------------------- verification

  /**
   * Starts BankID verification and returns where to send the browser. Signed-out
   * callers are sent to login first and come back here afterwards.
   */
  async startVerification(
    principal: Principal | undefined,
    query: { returnTo?: unknown; locale?: unknown },
  ): Promise<string> {
    const locale = ['nb', 'en', 'so'].includes(query.locale as string)
      ? (query.locale as string)
      : 'nb';
    const returnTo = safeReturnTo(query.returnTo, `/${locale}/account`);
    if (!principal) {
      const here = `/api/v1/trust/verification/start?${new URLSearchParams({ returnTo, locale })}`;
      return `/auth/login?${new URLSearchParams({ returnTo: here, locale })}`;
    }
    const pending = this.bankid.newRequest();
    await this.repo.saveRequest({
      state: pending.state,
      user_id: principal.sub,
      nonce: pending.nonce,
      code_verifier: pending.codeVerifier,
      return_to: returnTo,
    });
    const url = await this.bankid.authorizationUrl(pending, locale === 'nb' ? 'no' : 'en');
    return url.href;
  }

  /** Completes verification; always returns a same-site path with the outcome. */
  async completeVerification(principal: Principal | undefined, rawQuery: string): Promise<string> {
    const params = new URLSearchParams(rawQuery);
    const state = params.get('state');
    const request = state ? await this.repo.takeRequest(state) : null;
    const fallback = '/';
    const done = (outcome: VerificationOutcome, returnTo = request?.return_to ?? fallback) => {
      verificationsCounter.add(1, { outcome });
      return withOutcome(returnTo, outcome);
    };

    if (!request) return done('expired');
    // The state is bound to the user who started the flow (no account swapping).
    if (!principal || principal.sub !== request.user_id) return done('failed');
    if (Date.now() - request.created_at.getTime() > REQUEST_TTL_MS) return done('expired');
    if (params.get('error'))
      return done(params.get('error') === 'access_denied' ? 'cancelled' : 'failed');

    try {
      const hash = await this.bankid.complete(`?${rawQuery}`, {
        state: request.state,
        nonce: request.nonce,
        codeVerifier: request.code_verifier,
      });
      await this.repo.saveVerification(principal.sub, hash);
      return done('ok');
    } catch (error) {
      if (error instanceof UniqueViolation) return done('taken');
      this.logger.warn({ err: error }, 'BankID verification failed');
      return done('failed');
    }
  }

  async removeVerification(principal: Principal): Promise<void> {
    if (!(await this.repo.deleteVerification(principal.sub))) {
      throw new NotFoundException('Not verified');
    }
  }

  pruneRequests(): Promise<number> {
    return this.repo.pruneRequests(REQUEST_TTL_MS);
  }
}
