/** Audit actions and targets the console knows how to label and link (ADR-0028/0030). */
export const AUDIT_ACTIONS = [
  'listing.remove',
  'reports.dismiss',
  'review.remove',
  'payment.refund',
  'user.suspend',
  'user.unsuspend',
  'user.suspension_expired',
  'user.sign_out',
  'user.password_reset',
  'user.verify_email',
  'user.unlock',
  'user.note',
  'user.roles_change',
  'user.otp_reset',
] as const;

export const AUDIT_TARGETS = [
  'listing',
  'order',
  'user',
  'review',
  'report',
  'conversation',
  'system',
] as const;

/** Where the console shows a target, if it has a page for it. */
export function targetHref(type: string, id: string): string | null {
  if (type === 'user') return `/admin/users/${id}`;
  if (type === 'listing') return `/admin/listings/${id}`;
  if (type === 'order') return `/admin/orders/${id}`;
  return null;
}

/** One CSV cell: quoted, and never read as a formula by spreadsheets (CSV injection). */
export function csvCell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
