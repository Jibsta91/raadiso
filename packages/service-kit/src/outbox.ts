import { context, propagation } from '@opentelemetry/api';

/** Anything that can run a parameterised query (pg Pool or PoolClient). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export interface OutboxEvent {
  id: string;
  type: string;
}

/**
 * Appends a CloudEvent to the service's outbox table (ADR-0008). Call it with
 * the transaction's client so the event commits atomically with the state
 * change. Debezium routes the row to raadi.<aggregateType>.events, keyed by
 * aggregateId; the current W3C trace context travels along as a header.
 */
export async function appendToOutbox(
  db: Queryable,
  aggregateType: string,
  aggregateId: string,
  event: OutboxEvent,
): Promise<void> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  await db.query(
    `INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, traceparent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [event.id, aggregateType, aggregateId, event.type, event, carrier.traceparent ?? null],
  );
}

export interface JanitorOptions {
  /** Outbox rows older than this are deleted (default 7 days). Debezium reads the WAL, not the rows. */
  outboxDays?: number;
  /**
   * Inbox rows (processed_events) older than this are deleted (default 30 days). They only have to
   * outlive a redelivery: topics keep events for 14 days.
   */
  processedDays?: number;
  /** How often to run (default hourly). */
  intervalMs?: number;
  log?: (obj: object, msg: string) => void;
}

/** A pool that can also hand out one client, for a session-level advisory lock. */
export interface JanitorPool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
    release(): void;
  }>;
}

const JANITOR_LOCK = 0x6f7574626f78; // "outbox"
const BATCH = 5000;

/** One pass of the janitor (see startEventTableJanitor). Returns the rows deleted per table. */
export async function pruneEventTables(
  pool: JanitorPool,
  opts: JanitorOptions = {},
): Promise<Record<string, number>> {
  const tables = [
    { name: 'outbox', column: 'created_at', days: opts.outboxDays ?? 7 },
    { name: 'processed_events', column: 'processed_at', days: opts.processedDays ?? 30 },
  ];
  const deleted: Record<string, number> = {};
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [JANITOR_LOCK]);
    if (!(rows[0] as { ok: boolean }).ok) return deleted;
    try {
      for (const t of tables) {
        const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [t.name]);
        if (!(exists.rows[0] as { ok: boolean }).ok) continue;
        let n = 0;
        for (;;) {
          const res = await client.query(
            `DELETE FROM ${t.name} WHERE ctid IN (
               SELECT ctid FROM ${t.name}
                WHERE ${t.column} < now() - make_interval(days => $1::int) LIMIT ${BATCH})`,
            [t.days],
          );
          n += res.rowCount ?? 0;
          if ((res.rowCount ?? 0) < BATCH) break;
        }
        deleted[t.name] = n;
        if (n) opts.log?.({ table: t.name, deleted: n }, 'deleted old event rows');
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [JANITOR_LOCK]);
    }
  } finally {
    client.release();
  }
  return deleted;
}

/**
 * Deletes old rows from the service's `outbox` and `processed_events` tables (whichever exist), so
 * they do not grow forever and do not keep personal data (listing texts in event payloads) after the
 * thing they describe is gone. One instance at a time (advisory lock), in batches. Returns a stop
 * function; the timer does not keep the process alive.
 */
export function startEventTableJanitor(pool: JanitorPool, opts: JanitorOptions = {}): () => void {
  const run = () => pruneEventTables(pool, opts);
  const tick = () =>
    void run().catch((err: unknown) => opts.log?.({ err }, 'event table cleanup failed'));
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, opts.intervalMs ?? 3_600_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
