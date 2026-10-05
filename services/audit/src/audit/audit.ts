import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Query,
  Req,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { parseEvent } from '@raadi/events';
import { type AuthenticatedRequest, Roles, Staff, ZodValidationPipe } from '@raadi/service-kit';
import { PermanentEventError, type ReceivedEvent } from '@raadi/service-kit/kafka';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../tokens.js';

const recorded = metrics
  .getMeter('audit')
  .createCounter('raadi.audit.entries', { description: 'Audit entries recorded, by action' });

export interface AuditRow {
  action_id: string;
  actor_id: string;
  actor_roles: string[];
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  details: Record<string, unknown> | null;
  source: string;
  at: Date;
}

export interface AuditEntry {
  id: string;
  actor: { id: string; roles: string[] };
  action: string;
  target: { type: string; id: string };
  reason: string | null;
  details: Record<string, unknown> | null;
  source: string;
  at: string;
}

export const toEntry = (r: AuditRow): AuditEntry => ({
  id: r.action_id,
  actor: { id: r.actor_id, roles: r.actor_roles },
  action: r.action,
  target: { type: r.target_type, id: r.target_id },
  reason: r.reason,
  details: r.details ?? null,
  source: r.source,
  at: r.at.toISOString(),
});

export const querySchema = z
  .object({
    actor: z.uuid().optional(),
    action: z.string().max(60).optional(),
    targetType: z.string().max(30).optional(),
    targetId: z.string().max(100).optional(),
    /** Entries older than this (the previous page's last `at`). */
    before: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type AuditQuery = z.infer<typeof querySchema>;

export const statsSchema = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(14) })
  .strict();

export const STAFF_ROLES = ['moderator', 'support', 'operator', 'platform-admin'] as const;

/** Daily counts for the console's charts (ADR-0030). */
export interface AuditStats {
  days: Array<{ day: string; count: number }>;
  actions: Array<{ action: string; count: number }>;
  actors: Array<{ id: string; count: number }>;
  total: number;
}

/** Records audit events and answers audit queries (ADR-0028). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Kafka handler for raadi.audit.events. Idempotent: the action id is the key. */
  async onEvent(event: ReceivedEvent): Promise<void> {
    let parsed;
    try {
      parsed = parseEvent(event.value);
    } catch (error) {
      throw new PermanentEventError('audit event violates its contract', { cause: error });
    }
    if (!parsed || parsed.type !== 'no.raadi.audit.action.v1') return;
    const d = parsed.data;
    const { rowCount } = await this.pool.query(
      `INSERT INTO audit_entries (action_id, actor_id, actor_roles, action, target_type, target_id,
                                  reason, details, source, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (action_id) DO NOTHING`,
      [
        d.actionId,
        d.actorId,
        d.actorRoles,
        d.action,
        d.targetType,
        d.targetId,
        d.reason ?? null,
        d.details ?? null,
        parsed.source,
        d.at,
      ],
    );
    if (rowCount) recorded.add(1, { action: d.action });
  }

  async query(q: AuditQuery): Promise<{ items: AuditEntry[]; hasMore: boolean }> {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      args.push(value);
      where.push(sql.replace('?', `$${args.length}`));
    };
    if (q.actor) add('actor_id = ?', q.actor);
    if (q.action) add('action = ?', q.action);
    if (q.targetType) add('target_type = ?', q.targetType);
    if (q.targetId) add('target_id = ?', q.targetId);
    if (q.before) add('at < ?', q.before);
    args.push(q.limit + 1);
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY at DESC, action_id LIMIT $${args.length}`,
      args,
    );
    return { items: rows.slice(0, q.limit).map(toEntry), hasMore: rows.length > q.limit };
  }

  /** Entries per day, most frequent actions and most active staff in the last `days` days. */
  async stats(days: number): Promise<AuditStats> {
    const [perDay, actions, actors] = await Promise.all([
      this.pool.query<{ day: string; count: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(e.action_id) AS count
           FROM generate_series(date_trunc('day', now()) - ($1 - 1) * interval '1 day',
                                date_trunc('day', now()), interval '1 day') d
           LEFT JOIN audit_entries e ON e.at >= d AND e.at < d + interval '1 day'
          GROUP BY d ORDER BY d`,
        [days],
      ),
      this.pool.query<{ action: string; count: string }>(
        `SELECT action, count(*) AS count FROM audit_entries
          WHERE at > now() - $1 * interval '1 day' GROUP BY action ORDER BY count DESC LIMIT 10`,
        [days],
      ),
      this.pool.query<{ id: string; count: string }>(
        `SELECT actor_id AS id, count(*) AS count FROM audit_entries
          WHERE at > now() - $1 * interval '1 day' GROUP BY actor_id ORDER BY count DESC LIMIT 10`,
        [days],
      ),
    ]);
    const daysOut = perDay.rows.map((r) => ({ day: r.day, count: Number(r.count) }));
    return {
      days: daysOut,
      actions: actions.rows.map((r) => ({ action: r.action, count: Number(r.count) })),
      actors: actors.rows.map((r) => ({ id: r.id, count: Number(r.count) })),
      total: daysOut.reduce((n, d) => n + d.count, 0),
    };
  }
}

@Controller('api/v1/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** The audit log, newest first (platform admins). */
  @Get('entries')
  @Roles('platform-admin')
  entries(@Query(new ZodValidationPipe(querySchema)) q: AuditQuery) {
    return this.audit.query(q);
  }
}

/**
 * The audit log for the admin console (ADR-0030): console tokens only. Platform admins read
 * everything; other staff read the history of one object (a user, listing, order …) or their own
 * actions, which the console shows on its detail pages.
 */
@Controller('admin/v1/audit')
export class AuditAdminController {
  constructor(private readonly audit: AuditService) {}

  @Get('entries')
  @Staff(STAFF_ROLES)
  entries(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(querySchema)) q: AuditQuery,
  ) {
    const p = req.principal!;
    if (!p.roles.includes('platform-admin') && !q.targetId && q.actor !== p.sub) {
      throw new BadRequestException('Name a target (targetId) or your own id (actor)');
    }
    return this.audit.query(q);
  }

  @Get('stats')
  @Staff(['platform-admin'])
  stats(@Query(new ZodValidationPipe(statsSchema)) q: { days: number }) {
    return this.audit.stats(q.days);
  }
}
