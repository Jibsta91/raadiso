import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { Staff } from '@raadi/service-kit';
import type pg from 'pg';
import { PG_POOL } from '../tokens.js';

type Channel = 'email' | 'push';

export interface NotificationsUser {
  userId: string;
  locale: string | null;
  emailMessages: boolean;
  devices: Array<{ platform: 'ios' | 'android'; createdAt: string; lastSeenAt: string }>;
  recent: Array<{
    channel: Channel;
    kind: string;
    status: string;
    attempts: number;
    createdAt: string;
    sentAt: string | null;
  }>;
}

export interface QueueStats {
  channels: Array<{
    channel: Channel;
    pending: number;
    sent24h: number;
    failed24h: number;
    skipped24h: number;
    oldestPendingAt: string | null;
  }>;
  /** The most frequent recent errors, e-mail addresses removed. */
  errors: Array<{ channel: Channel; error: string; count: number; lastAt: string }>;
}

/** Removes anything that looks like an e-mail address from provider errors. */
export const redact = (s: string) => s.replace(/[^\s<>@]+@[^\s<>@]+/g, '‹address›').slice(0, 200);

/**
 * Delivery for the admin console (ADR-0030): a user's devices and recent deliveries for support
 * (no addresses, tokens or message text), and the e-mail and push queues for operators.
 */
@Controller('admin/v1/notifications')
export class NotificationsAdminController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get('users/:id')
  @Staff(['support', 'platform-admin'])
  async user(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
  ): Promise<NotificationsUser> {
    const [locale, prefs, devices, recent] = await Promise.all([
      this.pool.query<{ locale: string }>('SELECT locale FROM user_locales WHERE user_id = $1', [
        id,
      ]),
      this.pool.query<{ email_messages: boolean }>(
        'SELECT email_messages FROM preferences WHERE user_id = $1',
        [id],
      ),
      this.pool.query<{ platform: 'ios' | 'android'; created_at: Date; last_seen_at: Date }>(
        'SELECT platform, created_at, last_seen_at FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC',
        [id],
      ),
      this.pool.query<{
        channel: Channel;
        kind: string;
        status: string;
        attempts: number;
        created_at: Date;
        sent_at: Date | null;
      }>(
        `(SELECT 'email' AS channel, kind, status, attempts, created_at, sent_at FROM emails
           WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20)
         UNION ALL
         (SELECT 'push' AS channel, kind, status, attempts, created_at, sent_at FROM pushes
           WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20)
         ORDER BY created_at DESC LIMIT 25`,
        [id],
      ),
    ]);
    return {
      userId: id,
      locale: locale.rows[0]?.locale ?? null,
      emailMessages: prefs.rows[0]?.email_messages ?? true,
      devices: devices.rows.map((d) => ({
        platform: d.platform,
        createdAt: d.created_at.toISOString(),
        lastSeenAt: d.last_seen_at.toISOString(),
      })),
      recent: recent.rows.map((r) => ({
        channel: r.channel,
        kind: r.kind,
        status: r.status,
        attempts: r.attempts,
        createdAt: r.created_at.toISOString(),
        sentAt: r.sent_at?.toISOString() ?? null,
      })),
    };
  }

  @Get('queues')
  @Staff(['operator', 'platform-admin'])
  async queues(): Promise<QueueStats> {
    const stats = (table: 'emails' | 'pushes') =>
      this.pool.query<{
        pending: string;
        sent: string;
        failed: string;
        skipped: string;
        oldest: Date | null;
      }>(
        `SELECT count(*) FILTER (WHERE status = 'pending') AS pending,
                count(*) FILTER (WHERE status = 'sent' AND created_at > now() - interval '1 day') AS sent,
                count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '1 day') AS failed,
                count(*) FILTER (WHERE status = 'skipped' AND created_at > now() - interval '1 day') AS skipped,
                min(created_at) FILTER (WHERE status = 'pending') AS oldest
           FROM ${table}`,
      );
    const errors = (table: 'emails' | 'pushes') =>
      this.pool.query<{ error: string; n: string; last: Date }>(
        `SELECT left(last_error, 300) AS error, count(*) AS n, max(created_at) AS last FROM ${table}
          WHERE last_error IS NOT NULL AND created_at > now() - interval '7 days'
          GROUP BY 1 ORDER BY n DESC LIMIT 5`,
      );
    const [e, p, ee, pe] = await Promise.all([
      stats('emails'),
      stats('pushes'),
      errors('emails'),
      errors('pushes'),
    ]);
    const channel = (c: Channel, r: (typeof e.rows)[number]) => ({
      channel: c,
      pending: Number(r.pending),
      sent24h: Number(r.sent),
      failed24h: Number(r.failed),
      skipped24h: Number(r.skipped),
      oldestPendingAt: r.oldest?.toISOString() ?? null,
    });
    return {
      channels: [channel('email', e.rows[0]!), channel('push', p.rows[0]!)],
      errors: [
        ...ee.rows.map((r) => ({ channel: 'email' as const, ...err(r) })),
        ...pe.rows.map((r) => ({ channel: 'push' as const, ...err(r) })),
      ],
    };
  }
}

const err = (r: { error: string; n: string; last: Date }) => ({
  error: redact(r.error),
  count: Number(r.n),
  lastAt: r.last.toISOString(),
});
