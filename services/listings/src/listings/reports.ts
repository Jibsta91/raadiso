import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Throttle } from '@nestjs/throttler';
import {
  audit,
  type AuthenticatedRequest,
  imageUrls,
  type ImgproxySigner,
  type Principal,
  Roles,
  withTransaction,
  ZodValidationPipe,
} from '@raadi/service-kit';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../tokens.js';
import { SIGNER } from './listings.service.js';

export const REPORT_REASONS = [
  'fraud',
  'prohibited',
  'offensive',
  'wrong_category',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    comment: z.string().trim().max(500).default(''),
  })
  .strict();

/**
 * At most this many open reports per person (flooding the queue). Reports a moderator has handled
 * no longer count.
 */
const OPEN_LIMIT = 20;

const meter = metrics.getMeter('listings');
const reported = meter.createCounter('raadi.listings.reports', {
  description: 'Reports by reason, and how moderators closed them (resolved, dismissed)',
});

export interface QueueItem {
  listing: {
    id: string;
    title: string;
    status: string;
    sellerName: string;
    image?: { thumb: string; card: string };
  };
  count: number;
  reasons: Partial<Record<ReportReason, number>>;
  /** The most recent comments (without who wrote them). */
  comments: Array<{ reason: ReportReason; comment: string; createdAt: string }>;
  firstReportedAt: string;
}

/**
 * Reports about listings and the moderators' queue (ADR-0027). Removing a
 * listing as a moderator resolves its open reports; dismissing closes them.
 */
@Injectable()
export class ReportsService implements OnModuleInit {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(SIGNER) private readonly signer: ImgproxySigner,
  ) {}

  /** The moderation backlog, so an unworked queue raises an alert (ModerationQueueStale). */
  onModuleInit(): void {
    const backlog = meter.createObservableGauge('raadi.listings.reports_open', {
      description: 'Listings with open reports, waiting for a moderator',
    });
    const oldest = meter.createObservableGauge('raadi.listings.reports_oldest_age', {
      description: 'Age of the oldest open report',
      unit: 's',
    });
    meter.addBatchObservableCallback(
      async (r) => {
        const { rows } = await this.pool
          .query<{ listings: string; oldest: number | null }>(
            `SELECT count(DISTINCT listing_id) AS listings,
                    extract(epoch FROM now() - min(created_at))::float8 AS oldest
               FROM reports WHERE status = 'open'`,
          )
          .catch(() => ({ rows: [] }));
        if (!rows[0]) return;
        r.observe(backlog, Number(rows[0].listings));
        r.observe(oldest, rows[0].oldest ?? 0);
      },
      [backlog, oldest],
    );
  }

  async report(
    reporterId: string,
    listingId: string,
    input: z.infer<typeof reportSchema>,
  ): Promise<{ created: boolean }> {
    const { rows } = await this.pool.query<{ owner_id: string; status: string }>(
      'SELECT owner_id, status FROM listings WHERE id = $1',
      [listingId],
    );
    const listing = rows[0];
    if (!listing || listing.status === 'deleted') throw new NotFoundException('Listing not found');
    if (listing.owner_id === reporterId) {
      throw new UnprocessableEntityException({
        message: 'You cannot report your own listing.',
        errors: [{ path: 'listingId', message: 'own listing', code: 'own_listing' }],
      });
    }
    const open = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM reports
        WHERE reporter_id = $1 AND status = 'open' AND listing_id <> $2`,
      [reporterId, listingId],
    );
    if (Number(open.rows[0]!.n) >= OPEN_LIMIT) {
      throw new UnprocessableEntityException({
        message: 'You have many open reports. Try again when the moderators have handled them.',
        errors: [{ path: 'reason', message: 'open limit', code: 'too_many_reports' }],
      });
    }
    const { rows: written } = await this.pool.query<{ created: boolean }>(
      `INSERT INTO reports (id, listing_id, reporter_id, reason, comment) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (listing_id, reporter_id) WHERE status = 'open'
       DO UPDATE SET reason = EXCLUDED.reason, comment = EXCLUDED.comment
       RETURNING (xmax = 0) AS created`,
      [randomUUID(), listingId, reporterId, input.reason, input.comment],
    );
    reported.add(1, { reason: input.reason });
    return { created: written[0]!.created };
  }

  /** Open reports grouped by listing, most reported first. */
  async queue(limit: number): Promise<{ items: QueueItem[] }> {
    const { rows } = await this.pool.query<{
      id: string;
      title: string;
      status: string;
      seller_name: string;
      image_ids: string[];
      count: string;
      reasons: Record<string, number>;
      comments: Array<{ reason: ReportReason; comment: string; created_at: string }>;
      first_reported_at: Date;
    }>(
      `SELECT l.id, l.title, l.status, l.seller_name, l.image_ids, r.count, r.reasons, r.comments,
              r.first_reported_at
         FROM (SELECT listing_id, count(*) AS count, min(created_at) AS first_reported_at,
                      (SELECT jsonb_object_agg(reason, n) FROM (
                         SELECT reason, count(*) AS n FROM reports x
                          WHERE x.listing_id = o.listing_id AND x.status = 'open' GROUP BY reason) g) AS reasons,
                      (SELECT coalesce(jsonb_agg(c ORDER BY c.created_at DESC), '[]'::jsonb) FROM (
                         SELECT reason, comment, created_at FROM reports y
                          WHERE y.listing_id = o.listing_id AND y.status = 'open' AND comment <> ''
                          ORDER BY created_at DESC LIMIT 5) c) AS comments
                 FROM reports o WHERE status = 'open' GROUP BY listing_id) r
         JOIN listings l ON l.id = r.listing_id
        ORDER BY r.count DESC, r.first_reported_at
        LIMIT $1`,
      [limit],
    );
    return {
      items: rows.map((r) => {
        const image = r.image_ids[0] ? imageUrls(this.signer, r.image_ids[0]) : undefined;
        return {
          listing: {
            id: r.id,
            title: r.title,
            status: r.status,
            sellerName: r.seller_name,
            ...(image ? { image: { thumb: image.thumb, card: image.card } } : {}),
          },
          count: Number(r.count),
          reasons: r.reasons,
          comments: r.comments.map((c) => ({
            reason: c.reason,
            comment: c.comment,
            createdAt: new Date(c.created_at).toISOString(),
          })),
          firstReportedAt: r.first_reported_at.toISOString(),
        };
      }),
    };
  }

  /** Dismisses a listing's open reports (the listing is fine), with an audit entry (ADR-0028). */
  async dismiss(listingId: string, moderator: Principal, note = ''): Promise<number> {
    return withTransaction(this.pool, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE reports SET status = 'dismissed', handled_by = $2, handled_at = now(),
                handled_note = $3
          WHERE listing_id = $1 AND status = 'open'`,
        [listingId, moderator.sub, note || null],
      );
      if (rowCount) {
        reported.add(rowCount, { outcome: 'dismissed' });
        await audit(db, 'urn:raadi:listings', moderator, {
          action: 'reports.dismiss',
          targetType: 'listing',
          targetId: listingId,
          ...(note ? { reason: note } : {}),
          details: { reports: rowCount },
        });
      }
      return rowCount ?? 0;
    });
  }
}

@Controller('api/v1/listings')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Report a listing. Reporting the same listing again updates the earlier open report. */
  @Post(':id/reports')
  @Roles('user')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(202)
  async report(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Body(new ZodValidationPipe(reportSchema)) body: z.infer<typeof reportSchema>,
  ): Promise<{ received: true }> {
    await this.reports.report(req.principal!.sub, id, body);
    return { received: true };
  }
}
