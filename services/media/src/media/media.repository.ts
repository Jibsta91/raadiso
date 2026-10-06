import { Inject, Injectable } from '@nestjs/common';
import { buildEvent, type EventData, type EventType } from '@raadi/events';
import { appendToOutbox, withTransaction } from '@raadi/service-kit';
import type pg from 'pg';
import { PG_POOL } from '../tokens.js';

export interface MediaRow {
  id: string;
  owner_id: string;
  status: 'ready' | 'rejected' | 'deleted';
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  rejection_reason: string | null;
  listing_id: string | null;
  created_at: Date;
  attached_at: Date | null;
}

export type RejectionReason = EventData<'no.raadi.media.media.rejected.v1'>['reason'];

@Injectable()
export class MediaRepository {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async findById(id: string): Promise<MediaRow | null> {
    const { rows } = await this.pool.query<MediaRow>('SELECT * FROM media WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  /** Stores a ready image and its `media.uploaded` event; beforeCommit writes the owner tuple. */
  async createReady(
    m: {
      id: string;
      ownerId: string;
      contentType: string;
      bytes: number;
      width: number;
      height: number;
      sha256: string;
      listingId?: string;
    },
    beforeCommit?: () => Promise<void>,
  ): Promise<MediaRow | null> {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query<MediaRow>(
        `INSERT INTO media (id, owner_id, status, content_type, bytes, width, height, sha256, listing_id, attached_at)
         VALUES ($1, $2, 'ready', $3, $4, $5, $6, $7, $8, CASE WHEN $8::uuid IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [m.id, m.ownerId, m.contentType, m.bytes, m.width, m.height, m.sha256, m.listingId ?? null],
      );
      const row = rows[0];
      if (!row) return null;
      await this.outbox(client, m.id, 'no.raadi.media.media.uploaded.v1', {
        mediaId: m.id,
        ownerId: m.ownerId,
        contentType: m.contentType,
        bytes: m.bytes,
        width: m.width,
        height: m.height,
      });
      await beforeCommit?.();
      return row;
    });
  }

  /** Keeps a record of the rejection (abuse analytics) without the bytes. */
  async createRejected(m: {
    id: string;
    ownerId: string;
    contentType: string;
    bytes: number;
    sha256: string;
    reason: RejectionReason;
    signature?: string;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO media (id, owner_id, status, content_type, bytes, sha256, rejection_reason)
         VALUES ($1, $2, 'rejected', $3, $4, $5, $6)`,
        [m.id, m.ownerId, m.contentType, m.bytes, m.sha256, m.reason],
      );
      await this.outbox(client, m.id, 'no.raadi.media.media.rejected.v1', {
        mediaId: m.id,
        ownerId: m.ownerId,
        reason: m.reason,
        ...(m.signature ? { signature: m.signature } : {}),
      });
    });
  }

  async markDeleted(id: string): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE media SET status = 'deleted', deleted_at = now() WHERE id = $1 AND status = 'ready'`,
        [id],
      );
      if (!rowCount) return false;
      await this.outbox(client, id, 'no.raadi.media.media.deleted.v1', { mediaId: id });
      return true;
    });
  }

  /**
   * Applies a listing event exactly once (inbox table) and only if it is newer than the last one
   * applied for that listing: attaches the listed images that belong to the listing's owner and
   * detaches the rest (all of them when `attach` is null, e.g. the listing was deleted). Returns false
   * if the event was already processed or is older than what is applied.
   */
  async syncListingImages(
    eventId: string,
    listingId: string,
    version: number,
    attach: { ownerId: string; imageIds: string[] } | null,
  ): Promise<boolean> {
    const imageIds = attach?.imageIds ?? [];
    return withTransaction(this.pool, async (client) => {
      const fresh = await client.query(
        'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [eventId],
      );
      if (!fresh.rowCount) return false;
      const newer = await client.query(
        `INSERT INTO listing_versions (listing_id, version) VALUES ($1, $2)
         ON CONFLICT (listing_id) DO UPDATE SET version = EXCLUDED.version
           WHERE listing_versions.version < EXCLUDED.version`,
        [listingId, version],
      );
      if (!newer.rowCount) return false;
      await client.query(
        `UPDATE media SET listing_id = NULL, attached_at = NULL
          WHERE listing_id = $1 AND NOT (id = ANY($2::uuid[]))`,
        [listingId, imageIds],
      );
      if (attach && imageIds.length) {
        await client.query(
          `UPDATE media SET listing_id = $1, attached_at = COALESCE(attached_at, now())
            WHERE id = ANY($2::uuid[]) AND owner_id = $3 AND status = 'ready'`,
          [listingId, imageIds, attach.ownerId],
        );
      }
      return true;
    });
  }

  /** Unattached ready images older than the TTL (candidates for garbage collection). */
  async orphans(olderThanHours: number, limit = 100): Promise<MediaRow[]> {
    const { rows } = await this.pool.query<MediaRow>(
      `SELECT * FROM media WHERE status = 'ready' AND listing_id IS NULL
          AND created_at < now() - make_interval(hours => $1::int) ORDER BY created_at LIMIT $2`,
      [Math.floor(olderThanHours), limit],
    );
    return rows;
  }

  /** Runs fn only if this instance holds the cluster-wide lock (one GC at a time). */
  async withAdvisoryLock(key: number, fn: () => Promise<void>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS ok',
        [key],
      );
      if (!rows[0]?.ok) return false;
      try {
        await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [key]);
      }
      return true;
    } finally {
      client.release();
    }
  }

  private async outbox<T extends EventType>(
    client: pg.PoolClient,
    mediaId: string,
    type: T,
    data: EventData<T>,
  ) {
    const event = buildEvent(type, { source: 'urn:raadi:media', subject: mediaId, data });
    await appendToOutbox(client, 'media', mediaId, event);
  }
}
