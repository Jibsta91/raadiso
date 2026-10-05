import { randomUUID } from 'node:crypto';
import { buildEvent, type EventData } from '@raadi/events';
import type { Principal } from './jwt.js';
import { appendToOutbox, type Queryable } from './outbox.js';

type AuditData = EventData<'no.raadi.audit.action.v1'>;
const STAFF = ['moderator', 'support', 'operator', 'platform-admin'] as const;

/**
 * Records a staff action in the service's outbox (ADR-0028). Call it with the transaction's
 * client, so the audit entry commits with the change it describes, or not at all.
 */
export async function audit(
  db: Queryable,
  source: string,
  actor: Principal,
  entry: Pick<AuditData, 'action' | 'targetType' | 'targetId' | 'reason' | 'details'>,
): Promise<void> {
  const event = buildEvent('no.raadi.audit.action.v1', {
    source,
    subject: actor.sub,
    data: {
      actionId: randomUUID(),
      actorId: actor.sub,
      actorRoles: STAFF.filter((r) => actor.roles.includes(r)),
      ...entry,
      at: new Date().toISOString(),
    },
  });
  await appendToOutbox(db, 'audit', actor.sub, event);
}
