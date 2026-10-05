import {
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
import { type AuthenticatedRequest, Staff, ZodValidationPipe } from '@raadi/service-kit';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../tokens.js';
import type { OrderRow, OrderStatus } from './model.js';
import { PaymentsService } from './payments.service.js';

const STATUSES = [
  'created',
  'authorized',
  'captured',
  'refunded',
  'cancelled',
  'expired',
  'failed',
] as const satisfies readonly OrderStatus[];

export const REFUND_REASONS = [
  'customer_request',
  'duplicate',
  'service_failure',
  'fraud',
  'goodwill',
  'other',
] as const;

export const ordersQuerySchema = z
  .object({
    q: z.string().trim().max(40).optional(),
    user: z.uuid().optional(),
    listing: z.uuid().optional(),
    status: z.enum(STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const refundSchema = z
  .object({ reasonCode: z.enum(REFUND_REASONS), note: z.string().trim().max(500).default('') })
  .strict();

export interface AdminOrder {
  id: string;
  userId: string;
  listingId: string;
  product: string;
  amountOre: number;
  currency: 'NOK';
  provider: string;
  providerRef: string | null;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderDetail extends AdminOrder {
  events: Array<{ from: string; to: string; source: string; at: string }>;
  promotion: { startsAt: string; endsAt: string; revokedAt: string | null } | null;
}

export interface PaymentStats {
  capturedOre30d: number;
  refundedOre30d: number;
  orders30d: number;
  byStatus: Array<{ status: string; count: number }>;
  /** Captured revenue per day (øre), last 30 days, oldest first. */
  revenue: Array<{ day: string; ore: number; orders: number }>;
  /** Orders waiting at the provider for more than 15 minutes. */
  stuck: number;
}

const toAdmin = (r: OrderRow): AdminOrder => ({
  id: r.id,
  userId: r.user_id,
  listingId: r.listing_id,
  product: r.product,
  amountOre: r.amount_ore,
  currency: r.currency,
  provider: r.provider,
  providerRef: r.provider_ref,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** The admin console's view of orders and revenue (ADR-0030). Console tokens only. */
@Injectable()
export class PaymentsAdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly payments: PaymentsService,
  ) {}

  async search(q: z.infer<typeof ordersQuerySchema>) {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      args.push(value);
      where.push(sql.replaceAll('?', `$${args.length}`));
    };
    if (q.q) add('(id::text LIKE ? OR provider_ref LIKE ?)', `${q.q.toLowerCase()}%`);
    if (q.user) add('user_id = ?', q.user);
    if (q.listing) add('listing_id = ?', q.listing);
    if (q.status) add('status = ?', q.status);
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [page, count] = await Promise.all([
      this.pool.query<OrderRow>(
        `SELECT * FROM orders ${filter} ORDER BY created_at DESC
          LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, q.limit, q.offset],
      ),
      this.pool.query<{ n: string }>(`SELECT count(*) AS n FROM orders ${filter}`, args),
    ]);
    return {
      items: page.rows.map(toAdmin),
      total: Number(count.rows[0]!.n),
      limit: q.limit,
      offset: q.offset,
    };
  }

  async detail(id: string): Promise<AdminOrderDetail> {
    const [order, events, promotion] = await Promise.all([
      this.pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]),
      this.pool.query<{ from_status: string; to_status: string; source: string; at: Date }>(
        'SELECT from_status, to_status, source, at FROM order_events WHERE order_id = $1 ORDER BY id',
        [id],
      ),
      this.pool.query<{ starts_at: Date; ends_at: Date; revoked_at: Date | null }>(
        'SELECT starts_at, ends_at, revoked_at FROM promotions WHERE order_id = $1',
        [id],
      ),
    ]);
    const row = order.rows[0];
    if (!row) throw new NotFoundException('Order not found');
    const p = promotion.rows[0];
    return {
      ...toAdmin(row),
      events: events.rows.map((e) => ({
        from: e.from_status,
        to: e.to_status,
        source: e.source,
        at: e.at.toISOString(),
      })),
      promotion: p
        ? {
            startsAt: p.starts_at.toISOString(),
            endsAt: p.ends_at.toISOString(),
            revokedAt: p.revoked_at?.toISOString() ?? null,
          }
        : null,
    };
  }

  async stats(): Promise<PaymentStats> {
    const [totals, byStatus, revenue, stuck] = await Promise.all([
      this.pool.query<{ captured: string; refunded: string; orders: string }>(
        `SELECT coalesce(sum(amount_ore) FILTER (WHERE status = 'captured'), 0) AS captured,
                coalesce(sum(amount_ore) FILTER (WHERE status = 'refunded'), 0) AS refunded,
                count(*) AS orders
           FROM orders WHERE created_at > now() - interval '30 days'`,
      ),
      this.pool.query<{ status: string; n: string }>(
        'SELECT status, count(*) AS n FROM orders GROUP BY status ORDER BY n DESC',
      ),
      this.pool.query<{ day: string; ore: string; orders: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(sum(o.amount_ore), 0) AS ore,
                count(o.id) AS orders
           FROM generate_series(date_trunc('day', now()) - interval '29 days',
                                date_trunc('day', now()), interval '1 day') d
           LEFT JOIN orders o ON o.status IN ('captured', 'refunded')
                             AND o.created_at >= d AND o.created_at < d + interval '1 day'
          GROUP BY d ORDER BY d`,
      ),
      this.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM orders WHERE status IN ('created', 'authorized')
            AND created_at < now() - interval '15 minutes' AND created_at > now() - interval '1 day'`,
      ),
    ]);
    const t = totals.rows[0]!;
    return {
      capturedOre30d: Number(t.captured),
      refundedOre30d: Number(t.refunded),
      orders30d: Number(t.orders),
      byStatus: byStatus.rows.map((r) => ({ status: r.status, count: Number(r.n) })),
      revenue: revenue.rows.map((r) => ({
        day: r.day,
        ore: Number(r.ore),
        orders: Number(r.orders),
      })),
      stuck: Number(stuck.rows[0]!.n),
    };
  }
}

const uuid = new ParseUUIDPipe({ version: undefined });

/** /admin/v1/payments: orders, refunds and revenue for the console (not routed by the gateway). */
@Controller('admin/v1/payments')
export class PaymentsAdminController {
  constructor(
    private readonly admin: PaymentsAdminService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('orders')
  @Staff(['support', 'platform-admin'])
  orders(@Query(new ZodValidationPipe(ordersQuerySchema)) q: z.infer<typeof ordersQuerySchema>) {
    return this.admin.search(q);
  }

  @Get('stats')
  @Staff(['support', 'operator', 'platform-admin'])
  stats() {
    return this.admin.stats();
  }

  @Get('orders/:id')
  @Staff(['support', 'platform-admin'])
  order(@Param('id', uuid) id: string) {
    return this.admin.detail(id);
  }

  /** Money leaves the platform: platform admins, with a recent sign-in and a reason. */
  @Post('orders/:id/refund')
  @Staff(['platform-admin'], { stepUp: true })
  @HttpCode(200)
  async refund(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(refundSchema)) body: z.infer<typeof refundSchema>,
  ) {
    await this.payments.refund(req.principal!, id, body);
    return this.admin.detail(id);
  }
}
