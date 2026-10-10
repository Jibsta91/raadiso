import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { buildEvent, type EventData, type ListingSnapshot } from '@raadi/events';
import { appendToOutbox, withTransaction } from '@raadi/service-kit';
import type pg from 'pg';
import { PG_POOL } from '../tokens.js';
import { type FavouriteRow, type ListingRow, priceOf, type SavedSearchRow } from './model.js';
import type { PublicListing } from './clients.js';

export type Alert = Omit<EventData<'no.raadi.saved.alert.v1'>, 'alertId'>;

/** Favourites, the listing projection behind them, saved searches and the outbox. */
@Injectable()
export class SavedRepository {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Runs `fn` for an event exactly once (inbox table), in one transaction. */
  async once(eventId: string, fn: (db: pg.PoolClient) => Promise<void>): Promise<boolean> {
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

  // ---------------------------------------------------------- favourites

  async favourite(userId: string, listing: PublicListing, max: number): Promise<'added' | 'full'> {
    return withTransaction(this.pool, async (db) => {
      // Serialise one user's adds so the limit holds under concurrent requests.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      const mine = await db.query<{ n: string; has: boolean }>(
        `SELECT count(*) AS n, bool_or(listing_id = $2) AS has FROM favourites WHERE user_id = $1`,
        [userId, listing.id],
      );
      if (mine.rows[0]?.has) return 'added';
      if (Number(mine.rows[0]?.n ?? 0) >= max) return 'full';
      await db.query(
        `INSERT INTO listings (id, version, status, category, subcategory, title, price_minor,
                               image_id, place_name, region, published_at, currency, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           version = EXCLUDED.version, status = EXCLUDED.status, title = EXCLUDED.title,
           price_minor = EXCLUDED.price_minor, currency = EXCLUDED.currency,
           image_id = EXCLUDED.image_id, updated_at = now()
         WHERE listings.version < EXCLUDED.version`,
        [
          listing.id,
          listing.version,
          listing.status,
          listing.category,
          listing.subcategory,
          listing.title,
          listing.price?.amountMinor ?? null,
          listing.images[0]?.id ?? null,
          listing.location.name,
          listing.location.region,
          listing.publishedAt,
          listing.price?.currency ?? null,
          listing.country,
        ],
      );
      await db.query('INSERT INTO favourites (user_id, listing_id) VALUES ($1, $2)', [
        userId,
        listing.id,
      ]);
      return 'added';
    });
  }

  async unfavourite(userId: string, listingId: string): Promise<void> {
    await withTransaction(this.pool, async (db) => {
      await db.query('DELETE FROM favourites WHERE user_id = $1 AND listing_id = $2', [
        userId,
        listingId,
      ]);
      // Keep the projection only while someone still has the listing as a favourite.
      await db.query(
        'DELETE FROM listings WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM favourites WHERE listing_id = $1)',
        [listingId],
      );
    });
  }

  async favourites(userId: string, limit: number, offset: number) {
    const [items, total] = await Promise.all([
      this.pool.query<FavouriteRow>(
        `SELECT l.*, f.created_at AS favourited_at FROM favourites f
           JOIN listings l ON l.id = f.listing_id
          WHERE f.user_id = $1 AND l.status <> 'deleted'
          ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      this.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM favourites f JOIN listings l ON l.id = f.listing_id
          WHERE f.user_id = $1 AND l.status <> 'deleted'`,
        [userId],
      ),
    ]);
    return { items: items.rows, total: Number(total.rows[0]!.n) };
  }

  /** How many people saved each of these listings; listings nobody saved are left out. */
  async favouriteCounts(listingIds: readonly string[]): Promise<Record<string, number>> {
    if (!listingIds.length) return {};
    const { rows } = await this.pool.query<{ listing_id: string; n: string }>(
      `SELECT listing_id, count(*) AS n FROM favourites WHERE listing_id = ANY($1::uuid[])
       GROUP BY listing_id`,
      [listingIds],
    );
    return Object.fromEntries(rows.map((r) => [r.listing_id, Number(r.n)]));
  }

  async favouriteIds(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ listing_id: string }>(
      'SELECT listing_id FROM favourites WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000',
      [userId],
    );
    return rows.map((r) => r.listing_id);
  }

  // ------------------------------------------------- listing projection

  /**
   * Applies a listing event to a favourited listing and returns the alerts it
   * causes (a lower price, or sold). Unknown listings (nobody's favourite) and
   * stale versions are ignored.
   */
  async applyListing(db: pg.PoolClient, listing: ListingSnapshot): Promise<Alert[]> {
    const { rows } = await db.query<ListingRow>('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [
      listing.id,
    ]);
    const before = rows[0];
    if (!before || before.version >= listing.version) return [];
    // Events from before ADR-0040 carry kroner only.
    const price =
      listing.price !== undefined
        ? listing.price
        : listing.priceNok === null
          ? null
          : { amountMinor: listing.priceNok * 100, currency: 'NOK' };
    await db.query(
      `UPDATE listings SET version = $2, owner_id = $3, status = $4, category = $5, subcategory = $6,
              title = $7, price_minor = $8, image_id = $9, place_name = $10, region = $11,
              currency = $12, country = $13, updated_at = now()
        WHERE id = $1`,
      [
        listing.id,
        listing.version,
        listing.ownerId,
        listing.status,
        listing.category,
        listing.subcategory,
        listing.title,
        price?.amountMinor ?? null,
        listing.imageIds[0] ?? null,
        listing.location.name,
        listing.location.region ?? listing.location.county,
        price?.currency ?? null,
        listing.country ?? before.country,
      ],
    );
    const oldPrice = priceOf(before);
    const alerts: Array<Omit<Alert, 'userId'>> = [];
    if (before.status === 'active' && listing.status === 'sold') {
      alerts.push({ kind: 'sold', listingId: listing.id });
    } else if (
      listing.status === 'active' &&
      oldPrice !== null &&
      price !== null &&
      price.currency === oldPrice.currency &&
      price.amountMinor < oldPrice.amountMinor
    ) {
      alerts.push({
        kind: 'price_drop',
        listingId: listing.id,
        previousPrice: oldPrice,
        price,
        // For consumers that predate ADR-0040.
        ...(price.currency === 'NOK'
          ? {
              previousPriceNok: Math.floor(oldPrice.amountMinor / 100),
              priceNok: Math.floor(price.amountMinor / 100),
            }
          : {}),
      });
    }
    if (!alerts.length) return [];
    const fans = await db.query<{ user_id: string }>(
      'SELECT user_id FROM favourites WHERE listing_id = $1',
      [listing.id],
    );
    return fans.rows
      .filter((f) => f.user_id !== listing.ownerId)
      .flatMap((f) => alerts.map((a) => ({ ...a, userId: f.user_id })));
  }

  async markDeleted(db: pg.PoolClient, listingId: string, version: number): Promise<void> {
    await db.query(
      `UPDATE listings SET status = 'deleted', version = $2, updated_at = now()
        WHERE id = $1 AND version < $2`,
      [listingId, version],
    );
  }

  /** Writes alerts to the outbox (keyed by user, so one user's alerts stay in order). */
  async alert(db: pg.PoolClient, alerts: Alert[]): Promise<void> {
    for (const a of alerts) {
      const event = buildEvent('no.raadi.saved.alert.v1', {
        source: 'urn:raadi:saved',
        subject: a.userId,
        data: { alertId: randomUUID(), ...a },
      });
      await appendToOutbox(db, 'alert', a.userId, event);
    }
  }

  // ----------------------------------------------------- saved searches

  async savedSearches(userId: string): Promise<SavedSearchRow[]> {
    const { rows } = await this.pool.query<SavedSearchRow>(
      'SELECT * FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows;
  }

  async savedSearch(userId: string, id: string): Promise<SavedSearchRow | null> {
    const { rows } = await this.pool.query<SavedSearchRow>(
      'SELECT * FROM saved_searches WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ?? null;
  }

  /** Saves a search; the same query saved twice returns the existing one. */
  async saveSearch(
    userId: string,
    s: { name: string; params: Record<string, string>; notify: boolean },
    max: number,
  ): Promise<{ row: SavedSearchRow; created: boolean } | 'full'> {
    return withTransaction(this.pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      const existing = await db.query<SavedSearchRow>(
        'SELECT * FROM saved_searches WHERE user_id = $1 AND params = $2',
        [userId, s.params],
      );
      if (existing.rows[0]) return { row: existing.rows[0], created: false };
      const { rows } = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM saved_searches WHERE user_id = $1',
        [userId],
      );
      if (Number(rows[0]!.n) >= max) return 'full';
      const inserted = await db.query<SavedSearchRow>(
        `INSERT INTO saved_searches (id, user_id, name, params, notify)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [randomUUID(), userId, s.name, s.params, s.notify],
      );
      return { row: inserted.rows[0]!, created: true };
    });
  }

  async updateSearch(
    userId: string,
    id: string,
    change: { name?: string; notify?: boolean },
  ): Promise<SavedSearchRow | null> {
    const { rows } = await this.pool.query<SavedSearchRow>(
      `UPDATE saved_searches SET name = COALESCE($3, name), notify = COALESCE($4, notify),
              -- Switching alerts back on starts from now, not from when they were switched off.
              checked_until = CASE WHEN $4 AND NOT notify THEN now() ELSE checked_until END
        WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, change.name ?? null, change.notify ?? null],
    );
    return rows[0] ?? null;
  }

  async deleteSearch(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rowCount === 1;
  }

  async markSeen(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'UPDATE saved_searches SET new_count = 0 WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rowCount === 1;
  }

  /**
   * Claims due saved searches for this worker: the lease (next run pushed into
   * the future) keeps other instances off them while they run.
   */
  async claimDueSearches(limit: number, leaseMs: number): Promise<SavedSearchRow[]> {
    const { rows } = await this.pool.query<SavedSearchRow>(
      `UPDATE saved_searches SET next_run_at = now() + make_interval(secs => $2::double precision / 1000)
        WHERE id IN (SELECT id FROM saved_searches WHERE notify AND next_run_at <= now()
                      ORDER BY next_run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [limit, leaseMs],
    );
    return rows;
  }

  /** Records a check: moves the window forward and, with new matches, raises the count and alerts. */
  async recordCheck(
    search: SavedSearchRow,
    until: Date,
    matches: number,
    nextRunInMs: number,
  ): Promise<void> {
    await withTransaction(this.pool, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE saved_searches SET checked_until = $2, new_count = new_count + $3,
                next_run_at = now() + make_interval(secs => $4::double precision / 1000)
          -- JS dates carry milliseconds, PostgreSQL microseconds: compare at millisecond precision.
          WHERE id = $1 AND notify
            AND date_trunc('milliseconds', checked_until) = date_trunc('milliseconds', $5::timestamptz)`,
        [search.id, until, matches, nextRunInMs, search.checked_until],
      );
      // Deleted, muted or checked by someone else meanwhile: no alert.
      if (rowCount && matches > 0) {
        await this.alert(db, [
          {
            userId: search.user_id,
            kind: 'search_match',
            savedSearchId: search.id,
            count: matches,
          },
        ]);
      }
    });
  }
}
