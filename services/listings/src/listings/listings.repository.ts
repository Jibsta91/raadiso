import { Inject, Injectable } from '@nestjs/common';
import { findPlace } from '@raadi/catalog';
import { buildEvent, type EventData, type EventType } from '@raadi/events';
import { appendToOutbox, audit, type Principal, withTransaction } from '@raadi/service-kit';
import type pg from 'pg';
import { PG_POOL } from '../tokens.js';
import {
  type CreateListing,
  type ListingRow,
  type ListingStatus,
  type RemovalReason,
  toSnapshot,
} from './listing.model.js';

const COLUMNS = `id, owner_id, seller_name, country, category, subcategory, title, description, price_minor, currency,
  attributes, place_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
  image_ids, status, version, created_at, updated_at, published_at, promoted_until, removed_by,
  removal_reason, previous_price_minor, price_dropped_at`;

export class VersionConflictError extends Error {}

export interface NewListing extends CreateListing {
  id: string;
  ownerId: string;
  sellerName: string;
  publishedAt?: Date;
  /** Demo data only: a price drop that happened before the seed (ADR-0044). */
  priceDrop?: { previousMinor: number; at: Date };
}

/** One entry of a listing's price history (ADR-0044). */
export interface PriceChange {
  amountMinor: number | null;
  currency: string | null;
  at: string;
}

/** Data access for listings. Every state change writes its event in the same transaction. */
@Injectable()
export class ListingsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async findById(id: string): Promise<ListingRow | null> {
    const { rows } = await this.pool.query<ListingRow>(
      `SELECT ${COLUMNS} FROM listings WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listByOwner(
    ownerId: string,
    limit: number,
    offset: number,
    withRemoved = false,
  ): Promise<{ rows: ListingRow[]; total: number }> {
    // The owner sees what a moderator removed for 90 days, with the reason (DSA Art. 17); what they
    // deleted themselves is gone.
    const visible = withRemoved
      ? `(status <> 'deleted' OR (removed_by = 'moderation' AND updated_at > now() - interval '90 days'))`
      : `status <> 'deleted'`;
    const [page, count] = await Promise.all([
      this.pool.query<ListingRow>(
        `SELECT ${COLUMNS} FROM listings WHERE owner_id = $1 AND ${visible}
          ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [ownerId, limit, offset],
      ),
      this.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM listings WHERE owner_id = $1 AND ${visible}`,
        [ownerId],
      ),
    ]);
    return { rows: page.rows, total: Number(count.rows[0]!.n) };
  }

  async countActive(ownerId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM listings WHERE owner_id = $1 AND status = 'active'`,
      [ownerId],
    );
    return Number(rows[0]!.n);
  }

  /**
   * Inserts a listing and its `listing.published` event. `beforeCommit` runs
   * inside the transaction (e.g. writing authorization tuples), so a failure
   * there rolls the listing back. Returns null if the id already exists.
   */
  async create(
    input: NewListing,
    beforeCommit?: (row: ListingRow) => Promise<void>,
  ): Promise<ListingRow | null> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.insert(client, input);
      if (!row) return null;
      await this.recordPrice(client, row);
      await this.outbox(client, row, 'no.raadi.listings.listing.published.v1', {
        listing: toSnapshot(row),
      });
      await beforeCommit?.(row);
      return row;
    });
  }

  /** Bulk insert for the demo seeder; existing ids are skipped. Returns inserted rows. */
  async createMany(inputs: NewListing[]): Promise<ListingRow[]> {
    return withTransaction(this.pool, async (client) => {
      const inserted: ListingRow[] = [];
      for (const input of inputs) {
        const row = await this.insert(client, input);
        if (!row) continue;
        if (input.priceDrop) {
          await client.query(
            'INSERT INTO price_history (listing_id, price_minor, currency, changed_at) VALUES ($1, $2, $3, $4)',
            [row.id, input.priceDrop.previousMinor, row.currency, row.published_at],
          );
        }
        await this.recordPrice(client, row, input.priceDrop?.at);
        await this.outbox(client, row, 'no.raadi.listings.listing.published.v1', {
          listing: toSnapshot(row),
        });
        inserted.push(row);
      }
      return inserted;
    });
  }

  /**
   * Applies a full replacement of the editable fields (already merged and
   * validated) if `expectedVersion` still matches, and emits `listing.updated`.
   */
  async update(
    id: string,
    expectedVersion: number,
    next: CreateListing & { status: ListingStatus },
  ): Promise<ListingRow> {
    return withTransaction(this.pool, async (client) => {
      const place = findPlace(next.placeId)!;
      // A lower price in the same currency is a drop (kept until the price goes up); any other change of
      // price clears it (ADR-0044). In SET, the columns are the old values.
      const { rows } = await client.query<ListingRow & { price_changed: boolean }>(
        `UPDATE listings
            SET previous_price_minor = CASE
                  WHEN $7::bigint < price_minor AND currency = $14 THEN price_minor
                  WHEN $7::bigint IS DISTINCT FROM price_minor OR $14 IS DISTINCT FROM currency THEN NULL
                  ELSE previous_price_minor END,
                price_dropped_at = CASE
                  WHEN $7::bigint < price_minor AND currency = $14 THEN now()
                  WHEN $7::bigint IS DISTINCT FROM price_minor OR $14 IS DISTINCT FROM currency THEN NULL
                  ELSE price_dropped_at END,
                category = $3, subcategory = $4, title = $5, description = $6, price_minor = $7,
                currency = $14, attributes = $8, place_id = $9, country = $15,
                location = ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography,
                image_ids = $12, status = $13, version = version + 1, updated_at = now()
          WHERE id = $1 AND version = $2 AND status <> 'deleted'
          RETURNING ${COLUMNS}`,
        [
          id,
          expectedVersion,
          next.category,
          next.subcategory,
          next.title,
          next.description,
          next.price?.amountMinor ?? null,
          next.attributes,
          next.placeId,
          place.lon,
          place.lat,
          next.imageIds,
          next.status,
          next.price?.currency ?? null,
          place.country,
        ],
      );
      const row = rows[0];
      if (!row)
        throw new VersionConflictError(`listing ${id} changed since version ${expectedVersion}`);
      await this.recordPrice(client, row);
      await this.outbox(client, row, 'no.raadi.listings.listing.updated.v1', {
        listing: toSnapshot(row),
      });
      return row;
    });
  }

  /**
   * Records a listing's promotion end from payments (exactly once per event).
   * Bumps the version so search reindexes, but not updated_at: a promotion is
   * not an edit of the listing's content.
   */
  async applyPromotion(eventId: string, listingId: string, until: Date | null): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const fresh = await client.query(
        'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [eventId],
      );
      if (!fresh.rowCount) return;
      const { rows } = await client.query<ListingRow>(
        `UPDATE listings SET promoted_until = $2, version = version + 1
          WHERE id = $1 AND status <> 'deleted' RETURNING ${COLUMNS}`,
        [listingId, until],
      );
      const row = rows[0];
      if (!row) return; // deleted since: nothing to show
      await this.outbox(client, row, 'no.raadi.listings.listing.updated.v1', {
        listing: toSnapshot(row),
      });
    });
  }

  /**
   * Soft delete; emits `listing.deleted` so search and media can clean up and
   * the owner can be told when a moderator removed it.
   */
  /**
   * Removes a listing. A moderator's removal (pass `moderator`) also resolves the listing's open
   * reports and writes an audit entry, in the same transaction (ADR-0027, ADR-0028).
   */
  async softDelete(
    id: string,
    reason: 'owner' | 'moderation',
    moderator?: Principal,
    decision: { reasonCode?: RemovalReason; note?: string } = {},
  ): Promise<ListingRow | null> {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query<ListingRow>(
        `UPDATE listings SET status = 'deleted', version = version + 1, updated_at = now(),
                removed_by = $2, removal_reason = $3
          WHERE id = $1 AND status <> 'deleted' RETURNING ${COLUMNS}`,
        [id, reason, decision.reasonCode ?? null],
      );
      const row = rows[0];
      if (!row) return null;
      await this.outbox(client, row, 'no.raadi.listings.listing.deleted.v1', {
        listingId: row.id,
        version: row.version,
        imageIds: row.image_ids,
        ownerId: row.owner_id,
        title: row.title,
        reason,
      });
      if (moderator) {
        const { rowCount } = await client.query(
          `UPDATE reports SET status = 'resolved', handled_by = $2, handled_at = now(),
                  handled_note = $3
            WHERE listing_id = $1 AND status = 'open'`,
          [row.id, moderator.sub, decision.note || null],
        );
        await audit(client, 'urn:raadi:listings', moderator, {
          action: 'listing.remove',
          targetType: 'listing',
          targetId: row.id,
          ...(decision.note ? { reason: decision.note } : {}),
          details: {
            ownerId: row.owner_id,
            reports: rowCount ?? 0,
            ...(decision.reasonCode ? { reasonCode: decision.reasonCode } : {}),
          },
        });
      }
      return row;
    });
  }

  private async insert(client: pg.PoolClient, input: NewListing): Promise<ListingRow | null> {
    const place = findPlace(input.placeId)!;
    const { rows } = await client.query<ListingRow>(
      `INSERT INTO listings (id, owner_id, seller_name, category, subcategory, title, description, price_minor,
                             currency, country, attributes, place_id, location, image_ids, published_at,
                             created_at, updated_at, previous_price_minor, price_dropped_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $15, $16, $9, $10,
               ST_SetSRID(ST_MakePoint($11, $12), 4326)::geography, $13, $14, $14, $14, $17, $18)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        input.id,
        input.ownerId,
        input.sellerName,
        input.category,
        input.subcategory,
        input.title,
        input.description,
        input.price?.amountMinor ?? null,
        input.attributes,
        input.placeId,
        place.lon,
        place.lat,
        input.imageIds,
        input.publishedAt ?? new Date(),
        input.price?.currency ?? null,
        place.country,
        input.priceDrop?.previousMinor ?? null,
        input.priceDrop?.at ?? null,
      ],
    );
    return rows[0] ?? null;
  }

  /** Appends the listing's price to its history when it differs from the last one recorded. */
  private async recordPrice(client: pg.PoolClient, row: ListingRow, at?: Date): Promise<void> {
    await client.query(
      `INSERT INTO price_history (listing_id, price_minor, currency, changed_at)
       SELECT $1, $2, $3, COALESCE($4, now())
        WHERE NOT EXISTS (
          SELECT 1 FROM (SELECT price_minor, currency FROM price_history WHERE listing_id = $1
                          ORDER BY changed_at DESC LIMIT 1) last
           WHERE last.price_minor IS NOT DISTINCT FROM $2 AND last.currency IS NOT DISTINCT FROM $3)`,
      [row.id, row.price_minor, row.currency, at ?? null],
    );
  }

  /** A listing's prices over time, newest first (ADR-0044). */
  async priceHistory(id: string, limit = 20): Promise<PriceChange[]> {
    const { rows } = await this.pool.query<{
      price_minor: string | null;
      currency: string | null;
      changed_at: Date;
    }>(
      `SELECT price_minor, currency, changed_at FROM price_history
        WHERE listing_id = $1 ORDER BY changed_at DESC LIMIT $2`,
      [id, limit],
    );
    return rows.map((r) => ({
      amountMinor: r.price_minor === null ? null : Number(r.price_minor),
      currency: r.currency,
      at: r.changed_at.toISOString(),
    }));
  }

  private async outbox<T extends EventType>(
    client: pg.PoolClient,
    row: ListingRow,
    type: T,
    data: EventData<T>,
  ) {
    const event = buildEvent(type, { source: 'urn:raadi:listings', subject: row.id, data });
    await appendToOutbox(client, 'listing', row.id, event);
  }
}
