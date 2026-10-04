import { Controller, Get, Inject, Injectable, Logger, Query } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { parseEvent } from '@raadi/events';
import { Roles, ZodValidationPipe } from '@raadi/service-kit';
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
  source: string;
  at: Date;
}

export interface AuditEntry {
  id: string;
  actor: { id: string; roles: string[] };
  action: string;
  target: { type: string; id: string };
  reason: string | null;
  source: string;
  at: string;
}

export const toEntry = (r: AuditRow): AuditEntry => ({
  id: r.action_id,
  actor: { id: r.actor_id, roles: r.actor_roles },
  action: r.action,
  target: { type: r.target_type, id: r.target_id },
  reason: r.reason,
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
                                  reason, source, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (action_id) DO NOTHING`,
      [
        d.actionId,
        d.actorId,
        d.actorRoles,
        d.action,
        d.targetType,
        d.targetId,
        d.reason ?? null,
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
