import { adminAudit, type AuditQuery } from '@/lib/admin/api';
import { csvCell } from '@/lib/admin/audit';
import { isAdminHost } from '@/lib/host';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

const MAX = 5000;

/**
 * The audit log as CSV (platform admins, admin host only), with the page's filters; at most 5000
 * entries, newest first. Ids only, like the log itself.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  if (!(await isAdminHost()) || !session.authenticated || !canOpen('audit', session.user.roles)) {
    return new Response(null, { status: 404 });
  }
  const params = new URL(req.url).searchParams;
  const filters: AuditQuery = Object.fromEntries(
    (['actor', 'action', 'targetType', 'targetId'] as const)
      .map((k) => [k, params.get(k)?.trim()])
      .filter(([, v]) => v),
  );
  const rows = [
    [
      'at',
      'action',
      'actor_id',
      'actor_roles',
      'target_type',
      'target_id',
      'reason',
      'details',
      'source',
      'id',
    ],
  ].map((r) => r.map(csvCell).join(','));
  let before: string | undefined;
  for (let n = 0; n < MAX;) {
    const page = await adminAudit({ ...filters, ...(before ? { before } : {}), limit: 200 });
    for (const e of page.items) {
      rows.push(
        [
          e.at,
          e.action,
          e.actor.id,
          e.actor.roles.join(' '),
          e.target.type,
          e.target.id,
          e.reason,
          e.details,
          e.source,
          e.id,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    n += page.items.length;
    if (!page.hasMore || !page.items.length) break;
    before = page.items.at(-1)!.at;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(`${rows.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="raadiso-audit-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
