import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { buildEvent, type ListingSnapshot } from '@raadi/events';
import { appendToOutbox, audit, type Principal, withTransaction } from '@raadi/service-kit';
import type pg from 'pg';
import { PG_POOL } from '../tokens.js';
import type { DealFacts, ListingRow, ReviewRow, Role, VerificationRow } from './model.js';

type Db = pg.Pool | pg.PoolClient;

export class UniqueViolation extends Error {
  constructor(readonly constraint: string | undefined) {
    super(`unique violation${constraint ? ` (${constraint})` : ''}`);
  }
}

function rethrowUnique(error: unknown): never {
  const e = error as { code?: string; constraint?: string };
  if (e.code === '23505') throw new UniqueViolation(e.constraint);
  throw error;
}

export interface NewReview {
  listingId: string;
  listingTitle: string;
  reviewerId: string;
  reviewerName: string;
  subjectId: string;
  subjectRole: Role;
  rating: number;
  comment: string;
}

export interface VerificationRequest {
  state: string;
  user_id: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  created_at: Date;
}

/**
 * Projections of listing and message events, reviews (with their outbox
 * event in the same transaction) and verifications.
 */
@Injectable()
export class TrustRepository {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  // ---------------------------------------------------------------- events

  /** Runs `fn` for an event exactly once (inbox row in the same transaction). */
  async once(eventId: string, fn: (client: pg.PoolClient) => Promise<void>): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const fresh = await client.query(
        'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [eventId],
      );
      if (!fresh.rowCount) return false;
      await fn(client);
      return true;
    });
  }

  /**
   * Applies a listing snapshot unless a newer version is already stored.
   * `sold_at` records when the listing last became sold: it is set on the
   * change to sold, cleared on relisting and kept on deletion.
   */
  async applyListing(db: Db, l: ListingSnapshot): Promise<void> {
    await db.query(
      `INSERT INTO listings (id, owner_id, title, status, sold_at, version)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'sold' THEN $5::timestamptz END, $6)
       ON CONFLICT (id) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         title    = EXCLUDED.title,
         status   = EXCLUDED.status,
         sold_at  = CASE
                      WHEN EXCLUDED.status = 'sold' THEN
                        CASE WHEN listings.status = 'sold' AND listings.sold_at IS NOT NULL
                             THEN listings.sold_at ELSE $5::timestamptz END
                      WHEN EXCLUDED.status = 'active' THEN NULL
                      ELSE listings.sold_at
                    END,
         version  = EXCLUDED.version
       WHERE listings.version <= EXCLUDED.version`,
      [l.id, l.ownerId, l.title, l.status, l.updatedAt, l.version],
    );
  }

  async markListingDeleted(db: Db, listingId: string, version: number): Promise<void> {
    await db.query(
      `UPDATE listings SET status = 'deleted', version = $2 WHERE id = $1 AND version <= $2`,
      [listingId, version],
    );
  }

  async recordContact(
    db: Db,
    listingId: string,
    senderId: string,
    recipientId: string,
    at: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO contacts (listing_id, sender_id, recipient_id, first_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [listingId, senderId, recipientId, at],
    );
  }

  /** Remembers a public display name; names from tokens and listings both count. */
  async rememberName(userId: string, name: string, db: Db = this.pool): Promise<void> {
    await db.query(
      `INSERT INTO people (user_id, display_name) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
       WHERE people.display_name IS DISTINCT FROM EXCLUDED.display_name`,
      [userId, name],
    );
  }

  async name(userId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ display_name: string }>(
      'SELECT display_name FROM people WHERE user_id = $1',
      [userId],
    );
    return rows[0]?.display_name ?? null;
  }

  // ---------------------------------------------------------------- reviews

  async dealFacts(
    listingId: string,
    reviewerId: string,
    subjectId: string,
    db: Db = this.pool,
  ): Promise<DealFacts> {
    const { rows } = await db.query<{
      listing: ListingRow | null;
      reviewer_wrote: boolean;
      subject_wrote: boolean;
      already_reviewed: boolean;
    }>(
      `SELECT (SELECT row_to_json(l) FROM listings l WHERE l.id = $1) AS listing,
              EXISTS (SELECT 1 FROM contacts WHERE listing_id = $1 AND sender_id = $2 AND recipient_id = $3)
                AS reviewer_wrote,
              EXISTS (SELECT 1 FROM contacts WHERE listing_id = $1 AND sender_id = $3 AND recipient_id = $2)
                AS subject_wrote,
              EXISTS (SELECT 1 FROM reviews WHERE listing_id = $1 AND reviewer_id = $2 AND subject_id = $3)
                AS already_reviewed`,
      [listingId, reviewerId, subjectId],
    );
    const r = rows[0]!;
    const listing = r.listing
      ? {
          ...r.listing,
          sold_at: r.listing.sold_at ? new Date(r.listing.sold_at as unknown as string) : null,
        }
      : null;
    return {
      listing,
      reviewerWrote: r.reviewer_wrote,
      subjectWrote: r.subject_wrote,
      alreadyReviewed: r.already_reviewed,
    };
  }

  /**
   * Stores a review and its `review.published` event atomically. `decide`
   * sees the deal facts read inside the transaction (after locking the listing
   * row), so the decision and the insert see the same state. It throws to
   * refuse, or returns what the review records about the deal.
   */
  async createReview(
    input: Omit<NewReview, 'listingTitle' | 'subjectRole'>,
    decide: (facts: DealFacts) => Pick<NewReview, 'listingTitle' | 'subjectRole'>,
  ): Promise<ReviewRow> {
    try {
      return await withTransaction(this.pool, async (client) => {
        await client.query('SELECT 1 FROM listings WHERE id = $1 FOR SHARE', [input.listingId]);
        const facts = await this.dealFacts(
          input.listingId,
          input.reviewerId,
          input.subjectId,
          client,
        );
        const review: NewReview = { ...input, ...decide(facts) };
        const { rows } = await client.query<ReviewRow>(
          `INSERT INTO reviews (id, listing_id, listing_title, reviewer_id, reviewer_name, subject_id,
                                subject_role, rating, comment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            randomUUID(),
            review.listingId,
            review.listingTitle,
            review.reviewerId,
            review.reviewerName,
            review.subjectId,
            review.subjectRole,
            review.rating,
            review.comment,
          ],
        );
        const row = rows[0]!;
        await this.rememberName(review.reviewerId, review.reviewerName, client);
        await appendToOutbox(
          client,
          'review',
          row.id,
          buildEvent('no.raadi.trust.review.published.v1', {
            source: 'urn:raadi:trust',
            subject: row.id,
            data: {
              reviewId: row.id,
              listingId: row.listing_id,
              reviewerId: row.reviewer_id,
              subjectId: row.subject_id,
              subjectRole: row.subject_role,
              rating: row.rating,
              publishedAt: row.created_at.toISOString(),
            },
          }),
        );
        return row;
      });
    } catch (error) {
      rethrowUnique(error);
    }
  }

  async review(id: string): Promise<ReviewRow | null> {
    const { rows } = await this.pool.query<ReviewRow>('SELECT * FROM reviews WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  /**
   * Hides a review; the row stays so the same deal cannot be reviewed again. A moderator's removal
   * writes an audit entry in the same transaction (ADR-0028).
   */
  async removeReview(
    id: string,
    by: 'author' | 'moderator',
    moderator?: Principal,
  ): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE reviews SET removed_at = now(), removed_by = $2 WHERE id = $1 AND removed_at IS NULL`,
        [id, by],
      );
      if (rowCount === 1 && moderator) {
        await audit(client, 'urn:raadi:trust', moderator, {
          action: 'review.remove',
          targetType: 'review',
          targetId: id,
        });
      }
      return rowCount === 1;
    });
  }

  async reviewsAbout(
    subjectId: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: ReviewRow[]; counts: Array<{ rating: number; n: number }> }> {
    const [page, counts] = await Promise.all([
      this.pool.query<ReviewRow>(
        `SELECT * FROM reviews WHERE subject_id = $1 AND removed_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [subjectId, limit, offset],
      ),
      this.ratingCounts(subjectId),
    ]);
    return { rows: page.rows, counts };
  }

  async ratingCounts(subjectId: string): Promise<Array<{ rating: number; n: number }>> {
    const { rows } = await this.pool.query<{ rating: number; n: string }>(
      `SELECT rating, count(*) AS n FROM reviews WHERE subject_id = $1 AND removed_at IS NULL
       GROUP BY rating`,
      [subjectId],
    );
    return rows.map((r) => ({ rating: r.rating, n: Number(r.n) }));
  }

  async listing(id: string): Promise<ListingRow | null> {
    const { rows } = await this.pool.query<ListingRow>('SELECT * FROM listings WHERE id = $1', [
      id,
    ]);
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------- verification

  async verification(userId: string): Promise<VerificationRow | null> {
    const { rows } = await this.pool.query<VerificationRow>(
      'SELECT user_id, method, verified_at FROM verifications WHERE user_id = $1',
      [userId],
    );
    return rows[0] ?? null;
  }

  /** Throws UniqueViolation when the identity is already linked to another account. */
  async saveVerification(userId: string, identityHash: Buffer): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO verifications (user_id, method, identity_hash) VALUES ($1, 'bankid', $2)
         ON CONFLICT (user_id) DO UPDATE SET identity_hash = EXCLUDED.identity_hash, verified_at = now()`,
        [userId, identityHash],
      );
    } catch (error) {
      rethrowUnique(error);
    }
  }

  async deleteVerification(userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM verifications WHERE user_id = $1', [
      userId,
    ]);
    return rowCount === 1;
  }

  async saveRequest(req: Omit<VerificationRequest, 'created_at'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO verification_requests (state, user_id, nonce, code_verifier, return_to)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.state, req.user_id, req.nonce, req.code_verifier, req.return_to],
    );
  }

  /** Removes and returns a pending request: each state can be used once. */
  async takeRequest(state: string): Promise<VerificationRequest | null> {
    const { rows } = await this.pool.query<VerificationRequest>(
      'DELETE FROM verification_requests WHERE state = $1 RETURNING *',
      [state],
    );
    return rows[0] ?? null;
  }

  async pruneRequests(olderThanMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM verification_requests WHERE created_at < now() - make_interval(secs => $1)`,
      [olderThanMs / 1000],
    );
    return rowCount ?? 0;
  }
}
