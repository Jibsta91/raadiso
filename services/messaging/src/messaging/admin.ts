import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { Staff } from '@raadi/service-kit';
import type pg from 'pg';
import { PG_POOL } from '../tokens.js';

export interface MessagingUserStats {
  userId: string;
  conversations: { asBuyer: number; asSeller: number };
  messagesSent30d: number;
  lastMessageAt: string | null;
  blocks: { given: number; received: number };
}

export interface MessagingStats {
  /** Messages per day, last 14 days, oldest first. */
  messages: Array<{ day: string; count: number }>;
  conversations7d: number;
  blocks7d: number;
}

/**
 * Messaging for the admin console (ADR-0030): counts only. Staff never read message text here;
 * reports about messages will carry the reported message to moderators.
 */
@Controller('admin/v1/messaging')
export class MessagingAdminController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get('users/:id')
  @Staff(['moderator', 'support', 'platform-admin'])
  async user(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
  ): Promise<MessagingUserStats> {
    const { rows } = await this.pool.query<{
      buyer: string;
      seller: string;
      sent: string;
      last: Date | null;
      given: string;
      received: string;
    }>(
      `SELECT (SELECT count(*) FROM conversations WHERE buyer_id = $1) AS buyer,
              (SELECT count(*) FROM conversations WHERE seller_id = $1) AS seller,
              (SELECT count(*) FROM messages WHERE sender_id = $1
                  AND created_at > now() - interval '30 days') AS sent,
              (SELECT max(created_at) FROM messages WHERE sender_id = $1) AS last,
              (SELECT count(*) FROM blocks WHERE blocker_id = $1) AS given,
              (SELECT count(*) FROM blocks WHERE blocked_id = $1) AS received`,
      [id],
    );
    const r = rows[0]!;
    return {
      userId: id,
      conversations: { asBuyer: Number(r.buyer), asSeller: Number(r.seller) },
      messagesSent30d: Number(r.sent),
      lastMessageAt: r.last?.toISOString() ?? null,
      blocks: { given: Number(r.given), received: Number(r.received) },
    };
  }

  @Get('stats')
  @Staff(['moderator', 'support', 'operator', 'platform-admin'])
  async stats(): Promise<MessagingStats> {
    const [perDay, totals] = await Promise.all([
      this.pool.query<{ day: string; count: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(m.id) AS count
           FROM generate_series(date_trunc('day', now()) - interval '13 days',
                                date_trunc('day', now()), interval '1 day') d
           LEFT JOIN messages m ON m.created_at >= d AND m.created_at < d + interval '1 day'
          GROUP BY d ORDER BY d`,
      ),
      this.pool.query<{ conversations: string; blocks: string }>(
        `SELECT (SELECT count(*) FROM conversations WHERE created_at > now() - interval '7 days')
                  AS conversations,
                (SELECT count(*) FROM blocks WHERE created_at > now() - interval '7 days') AS blocks`,
      ),
    ]);
    return {
      messages: perDay.rows.map((r) => ({ day: r.day, count: Number(r.count) })),
      conversations7d: Number(totals.rows[0]!.conversations),
      blocks7d: Number(totals.rows[0]!.blocks),
    };
  }
}
