import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CATEGORY_KEYS } from '@raadi/catalog';
import {
  type AuthenticatedRequest,
  imageUrls,
  type ImgproxySigner,
  type Principal,
  Staff,
  ZodValidationPipe,
} from '@raadi/service-kit';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../tokens.js';
import { REMOVAL_REASONS, type RemovalReason } from './listing.model.js';
import { ListingsRepository } from './listings.repository.js';
import { SIGNER } from './listings.service.js';
import { type ReportReason, ReportsService } from './reports.js';

const STATUSES = ['active', 'sold', 'deleted'] as const;

export const adminSearchSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    owner: z.uuid().optional(),
    status: z.enum(STATUSES).optional(),
    category: z.enum(CATEGORY_KEYS).optional(),
    reported: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const removeSchema = z
  .object({ reasonCode: z.enum(REMOVAL_REASONS), note: z.string().trim().max(500).default('') })
  .strict();

export const dismissSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(50),
    note: z.string().trim().max(500).default(''),
  })
  .strict();

const queueSchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();

const historySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    handledBy: z.uuid().optional(),
  })
  .strict();

type Images = Array<{ thumb: string; card: string; large: string }>;

export interface AdminListing {
  id: string;
  title: string;
  status: (typeof STATUSES)[number];
  category: string;
  subcategory: string;
  priceNok: number | null;
  ownerId: string;
  sellerName: string;
  placeId: string;
  createdAt: string;
  updatedAt: string;
  promotedUntil: string | null;
  removedBy: 'owner' | 'moderation' | null;
  removalReason: RemovalReason | null;
  openReports: number;
  image: { thumb: string; card: string } | null;
}

export interface SellerSnapshot {
  ownerId: string;
  active: number;
  sold: number;
  deleted: number;
  removedByModeration: number;
  /** Reports about this seller's listings, ever (open, resolved and dismissed). */
  reports: number;
  firstListingAt: string | null;
}

export interface AdminReport {
  id: string;
  reason: ReportReason;
  comment: string;
  status: 'open' | 'resolved' | 'dismissed';
  reporterId: string;
  createdAt: string;
  handledBy: string | null;
  handledAt: string | null;
  handledNote: string | null;
}

export interface AdminListingDetail extends AdminListing {
  description: string;
  attributes: Record<string, string | number | boolean>;
  images: Images;
  version: number;
  reports: AdminReport[];
  seller: SellerSnapshot;
  otherListings: AdminListing[];
}

export interface WorkbenchItem {
  listing: AdminListingDetail;
  count: number;
  reasons: Partial<Record<ReportReason, number>>;
  firstReportedAt: string;
  /** A rough priority (0–100): report volume, fraud reports, seller history and age. */
  risk: number;
}

export interface ListingStats {
  active: number;
  sold: number;
  removed: number;
  created: Array<{ day: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  moderation: {
    open: number;
    listings: number;
    oldestAt: string | null;
    handled7d: number;
    removed7d: number;
    dismissed7d: number;
    /** Median time from the first report to the decision, last 7 days. */
    medianHandleSeconds: number | null;
    handled: Array<{ day: string; count: number }>;
  };
}

export interface HistoryItem {
  listingId: string;
  title: string;
  outcome: 'resolved' | 'dismissed';
  reports: number;
  handledBy: string;
  handledAt: string;
  note: string | null;
  secondsToDecision: number;
}

interface Row {
  id: string;
  title: string;
  status: AdminListing['status'];
  category: string;
  subcategory: string;
  price_nok: string | null;
  owner_id: string;
  seller_name: string;
  place_id: string;
  created_at: Date;
  updated_at: Date;
  promoted_until: Date | null;
  removed_by: AdminListing['removedBy'];
  removal_reason: RemovalReason | null;
  image_ids: string[];
  open_reports: string;
}

const SELECT = `SELECT l.id, l.title, l.status, l.category, l.subcategory, l.price_nok, l.owner_id,
  l.seller_name, l.place_id, l.created_at, l.updated_at, l.promoted_until, l.removed_by,
  l.removal_reason, l.image_ids,
  (SELECT count(*) FROM reports r WHERE r.listing_id = l.id AND r.status = 'open') AS open_reports
  FROM listings l`;

/**
 * The admin console's view of listings (ADR-0030): every listing in any state, its reports and
 * its seller's history, and moderation decisions with reasons. Console tokens only.
 */
@Injectable()
export class ListingsAdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(SIGNER) private readonly signer: ImgproxySigner,
    private readonly repo: ListingsRepository,
    private readonly reports: ReportsService,
  ) {}

  async search(q: z.infer<typeof adminSearchSchema>) {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      args.push(value);
      where.push(sql.replaceAll('?', `$${args.length}`));
    };
    if (q.q) {
      // An id (or its start) finds the listing; otherwise title and seller name.
      if (/^[0-9a-f-]{8,36}$/i.test(q.q)) add('l.id::text LIKE ?', `${q.q.toLowerCase()}%`);
      else add('(l.title ILIKE ? OR l.seller_name ILIKE ?)', `%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
    }
    if (q.owner) add('l.owner_id = ?', q.owner);
    if (q.status) add('l.status = ?', q.status);
    if (q.category) add('l.category = ?', q.category);
    if (q.reported === 'true')
      where.push(
        `EXISTS (SELECT 1 FROM reports r WHERE r.listing_id = l.id AND r.status = 'open')`,
      );
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [page, count] = await Promise.all([
      this.pool.query<Row>(
        `${SELECT} ${filter} ORDER BY l.created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, q.limit, q.offset],
      ),
      this.pool.query<{ n: string }>(`SELECT count(*) AS n FROM listings l ${filter}`, args),
    ]);
    return {
      items: page.rows.map((r) => this.toAdmin(r)),
      total: Number(count.rows[0]!.n),
      limit: q.limit,
      offset: q.offset,
    };
  }

  async detail(id: string): Promise<AdminListingDetail> {
    const { rows } = await this.pool.query<
      Row & { description: string; attributes: AdminListingDetail['attributes']; version: number }
    >(
      `SELECT x.*, l.description, l.attributes, l.version FROM (${SELECT} WHERE l.id = $1) x
         JOIN listings l ON l.id = x.id`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Listing not found');
    const [reports, seller, others] = await Promise.all([
      this.pool.query<{
        id: string;
        reason: ReportReason;
        comment: string;
        status: AdminReport['status'];
        reporter_id: string;
        created_at: Date;
        handled_by: string | null;
        handled_at: Date | null;
        handled_note: string | null;
      }>('SELECT * FROM reports WHERE listing_id = $1 ORDER BY created_at DESC LIMIT 100', [id]),
      this.seller(row.owner_id),
      this.pool.query<Row>(
        `${SELECT} WHERE l.owner_id = $1 AND l.id <> $2 ORDER BY l.created_at DESC LIMIT 6`,
        [row.owner_id, id],
      ),
    ]);
    return {
      ...this.toAdmin(row),
      description: row.description,
      attributes: row.attributes,
      version: row.version,
      images: row.image_ids.map((m) => {
        const u = imageUrls(this.signer, m);
        return { thumb: u.thumb, card: u.card, large: u.large };
      }),
      reports: reports.rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        comment: r.comment,
        status: r.status,
        reporterId: r.reporter_id,
        createdAt: r.created_at.toISOString(),
        handledBy: r.handled_by,
        handledAt: r.handled_at?.toISOString() ?? null,
        handledNote: r.handled_note,
      })),
      seller,
      otherListings: others.rows.map((r) => this.toAdmin(r)),
    };
  }

  /** The moderation workbench: reported listings with everything needed to decide. */
  async workbench(limit: number): Promise<{ items: WorkbenchItem[] }> {
    const { items } = await this.reports.queue(limit);
    const details = await Promise.all(items.map((i) => this.detail(i.listing.id)));
    return {
      items: items
        .map((item, i) => {
          const listing = details[i]!;
          const ageHours = (Date.now() - Date.parse(item.firstReportedAt)) / 3_600_000;
          const risk = Math.min(
            100,
            Math.round(
              item.count * 12 +
                (item.reasons.fraud ?? 0) * 18 +
                listing.seller.removedByModeration * 15 +
                (listing.seller.firstListingAt &&
                Date.now() - Date.parse(listing.seller.firstListingAt) < 7 * 86_400_000
                  ? 15
                  : 0) +
                Math.min(20, ageHours),
            ),
          );
          return {
            listing,
            count: item.count,
            reasons: item.reasons,
            firstReportedAt: item.firstReportedAt,
            risk,
          };
        })
        .sort((a, b) => b.risk - a.risk),
    };
  }

  async remove(
    actor: Principal,
    id: string,
    input: z.infer<typeof removeSchema>,
  ): Promise<{ removed: true }> {
    const row = await this.repo.softDelete(id, 'moderation', actor, input);
    if (!row) throw new NotFoundException('Listing not found or already removed');
    return { removed: true };
  }

  async dismiss(actor: Principal, input: z.infer<typeof dismissSchema>) {
    let closed = 0;
    for (const id of input.ids) closed += await this.reports.dismiss(id, actor, input.note);
    if (!closed) throw new BadRequestException('No open reports for these listings');
    return { closed };
  }

  async history(q: z.infer<typeof historySchema>): Promise<{ items: HistoryItem[] }> {
    const { rows } = await this.pool.query<{
      listing_id: string;
      title: string;
      status: HistoryItem['outcome'];
      reports: string;
      handled_by: string;
      handled_at: Date;
      note: string | null;
      seconds: number;
    }>(
      `SELECT r.listing_id, l.title, r.status, count(*) AS reports, r.handled_by, r.handled_at,
              max(r.handled_note) AS note,
              extract(epoch FROM r.handled_at - min(r.created_at))::float8 AS seconds
         FROM reports r JOIN listings l ON l.id = r.listing_id
        WHERE r.status <> 'open' ${q.handledBy ? 'AND r.handled_by = $2' : ''}
        GROUP BY r.listing_id, l.title, r.status, r.handled_by, r.handled_at
        ORDER BY r.handled_at DESC LIMIT $1`,
      q.handledBy ? [q.limit, q.handledBy] : [q.limit],
    );
    return {
      items: rows.map((r) => ({
        listingId: r.listing_id,
        title: r.title,
        outcome: r.status,
        reports: Number(r.reports),
        handledBy: r.handled_by,
        handledAt: r.handled_at.toISOString(),
        note: r.note,
        secondsToDecision: Math.max(0, Math.round(r.seconds)),
      })),
    };
  }

  async stats(): Promise<ListingStats> {
    const [counts, created, byCategory, open, handled, perDay] = await Promise.all([
      this.pool.query<{ status: string; n: string }>(
        'SELECT status, count(*) AS n FROM listings GROUP BY status',
      ),
      this.daily(`SELECT created_at AS at FROM listings`),
      this.pool.query<{ category: string; n: string }>(
        `SELECT category, count(*) AS n FROM listings WHERE status = 'active'
          GROUP BY category ORDER BY n DESC`,
      ),
      this.pool.query<{ open: string; listings: string; oldest: Date | null }>(
        `SELECT count(*) AS open, count(DISTINCT listing_id) AS listings, min(created_at) AS oldest
           FROM reports WHERE status = 'open'`,
      ),
      this.pool.query<{ status: string; n: string; median: number | null }>(
        `SELECT status, count(*) AS n,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM handled_at - created_at))
                  AS median
           FROM reports WHERE status <> 'open' AND handled_at > now() - interval '7 days'
          GROUP BY ROLLUP (status)`,
      ),
      this.daily(`SELECT handled_at AS at FROM reports WHERE status <> 'open'`),
    ]);
    const n = (status: string) => Number(counts.rows.find((r) => r.status === status)?.n ?? 0);
    const h = (status: string | null) => handled.rows.find((r) => r.status === status);
    return {
      active: n('active'),
      sold: n('sold'),
      removed: n('deleted'),
      created,
      byCategory: byCategory.rows.map((r) => ({ category: r.category, count: Number(r.n) })),
      moderation: {
        open: Number(open.rows[0]!.open),
        listings: Number(open.rows[0]!.listings),
        oldestAt: open.rows[0]!.oldest?.toISOString() ?? null,
        handled7d: Number(h(null)?.n ?? 0),
        removed7d: Number(h('resolved')?.n ?? 0),
        dismissed7d: Number(h('dismissed')?.n ?? 0),
        medianHandleSeconds: h(null)?.median == null ? null : Math.round(h(null)!.median!),
        handled: perDay,
      },
    };
  }

  async seller(ownerId: string): Promise<SellerSnapshot> {
    const { rows } = await this.pool.query<{
      active: string;
      sold: string;
      deleted: string;
      removed: string;
      first: Date | null;
      reports: string;
    }>(
      `SELECT count(*) FILTER (WHERE status = 'active') AS active,
              count(*) FILTER (WHERE status = 'sold') AS sold,
              count(*) FILTER (WHERE status = 'deleted') AS deleted,
              count(*) FILTER (WHERE removed_by = 'moderation') AS removed,
              min(created_at) AS first,
              (SELECT count(*) FROM reports r JOIN listings x ON x.id = r.listing_id
                WHERE x.owner_id = $1) AS reports
         FROM listings WHERE owner_id = $1`,
      [ownerId],
    );
    const r = rows[0]!;
    return {
      ownerId,
      active: Number(r.active),
      sold: Number(r.sold),
      deleted: Number(r.deleted),
      removedByModeration: Number(r.removed),
      reports: Number(r.reports),
      firstListingAt: r.first?.toISOString() ?? null,
    };
  }

  private async daily(source: string) {
    const { rows } = await this.pool.query<{ day: string; count: string }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(s.at) AS count
         FROM generate_series(date_trunc('day', now()) - interval '13 days',
                              date_trunc('day', now()), interval '1 day') d
         LEFT JOIN (${source}) s ON s.at >= d AND s.at < d + interval '1 day'
        GROUP BY d ORDER BY d`,
    );
    return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  private toAdmin(r: Row): AdminListing {
    const first = r.image_ids[0] ? imageUrls(this.signer, r.image_ids[0]) : null;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      category: r.category,
      subcategory: r.subcategory,
      priceNok: r.price_nok === null ? null : Number(r.price_nok),
      ownerId: r.owner_id,
      sellerName: r.seller_name,
      placeId: r.place_id,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      promotedUntil:
        r.promoted_until && r.promoted_until > new Date() ? r.promoted_until.toISOString() : null,
      removedBy: r.removed_by,
      removalReason: r.removal_reason,
      openReports: Number(r.open_reports),
      image: first ? { thumb: first.thumb, card: first.card } : null,
    };
  }
}

const uuid = new ParseUUIDPipe({ version: undefined });
const READ = ['moderator', 'support', 'platform-admin'] as const;
const MODERATE = ['moderator', 'platform-admin'] as const;

/** /admin/v1/listings: the console's listings and moderation (not routed by the gateway). */
@Controller('admin/v1/listings')
export class ListingsAdminController {
  constructor(private readonly admin: ListingsAdminService) {}

  @Get()
  @Staff(READ)
  search(@Query(new ZodValidationPipe(adminSearchSchema)) q: z.infer<typeof adminSearchSchema>) {
    return this.admin.search(q);
  }

  @Get('stats')
  @Staff(['moderator', 'support', 'operator', 'platform-admin'])
  stats() {
    return this.admin.stats();
  }

  @Get('workbench')
  @Staff(MODERATE)
  workbench(@Query(new ZodValidationPipe(queueSchema)) q: { limit: number }) {
    return this.admin.workbench(q.limit);
  }

  @Get('history')
  @Staff(MODERATE)
  history(@Query(new ZodValidationPipe(historySchema)) q: z.infer<typeof historySchema>) {
    return this.admin.history(q);
  }

  @Get('sellers/:id')
  @Staff(READ)
  seller(@Param('id', uuid) id: string) {
    return this.admin.seller(id);
  }

  /** Close the open reports of one or more listings (they are fine). */
  @Post('dismiss')
  @Staff(MODERATE)
  dismiss(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(dismissSchema)) body: z.infer<typeof dismissSchema>,
  ) {
    return this.admin.dismiss(req.principal!, body);
  }

  @Get(':id')
  @Staff(READ)
  detail(@Param('id', uuid) id: string) {
    return this.admin.detail(id);
  }

  @Post(':id/remove')
  @Staff(MODERATE)
  @HttpCode(200)
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(removeSchema)) body: z.infer<typeof removeSchema>,
  ) {
    return this.admin.remove(req.principal!, id, body);
  }
}
