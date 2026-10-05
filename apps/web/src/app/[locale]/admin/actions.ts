'use server';

import type { RemovalReason, StaffRole, SuspensionReason } from '@raadi/api-client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  addUserNote,
  AdminApiError,
  dismissAdminReports,
  getUser,
  type RefundReason,
  refundOrder,
  removeAdminListing,
  removeAdminReview,
  resetOtp,
  type ReviewRemovalReason,
  searchAdminListings,
  searchOrders,
  searchUsers,
  sendUserEmail,
  setStaffRoles,
  settle,
  signOutUser,
  suspendUser,
  unlockUser,
  unsuspendUser,
} from '@/lib/admin/api';
import {
  REFUND_REASONS,
  REMOVAL_REASONS,
  REVIEW_REMOVAL_REASONS,
  SUSPENSION_REASONS,
} from '@/lib/admin/reasons';
import { isAdminHost } from '@/lib/host';
import { logger } from '@/lib/logger';
import { getSession } from '@/lib/session';
import { canOpen, STAFF_ROLES } from '@/lib/staff';

/**
 * The console's actions (ADR-0030). They run on the server with the admin session's token; the
 * services check roles, the console client and step-up again, and write the audit entries.
 */

export type ActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      error: 'step_up' | 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'failed';
      message: string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUSPENSION: readonly SuspensionReason[] = SUSPENSION_REASONS;
const REMOVAL: readonly RemovalReason[] = REMOVAL_REASONS;
const REFUND: readonly RefundReason[] = REFUND_REASONS;
const REVIEW: readonly ReviewRemovalReason[] = REVIEW_REMOVAL_REASONS;

const text = (form: FormData, name: string, max = 500) =>
  String(form.get(name) ?? '')
    .trim()
    .slice(0, max);
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  (allowed as readonly string[]).includes(value) ? (value as T) : null;

async function run(
  done: string,
  fn: () => Promise<unknown>,
  revalidate = '/[locale]/admin',
): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  if (!(await isAdminHost())) return { ok: false, error: 'forbidden', message: t('forbidden') };
  try {
    await fn();
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: 'invalid', message: t('invalid') };
    if (!(error instanceof AdminApiError)) {
      logger.error({ err: error }, 'admin action failed');
      return { ok: false, error: 'failed', message: t('failed') };
    }
    if (error.stepUp) return { ok: false, error: 'step_up', message: t('stepUp') };
    const map = {
      400: ['invalid', error.detail ?? t('invalid')],
      403: ['forbidden', error.detail ?? t('forbidden')],
      404: ['not_found', t('notFound')],
      409: ['conflict', error.detail ?? t('conflict')],
    } as const;
    const [code, message] = map[error.status as keyof typeof map] ?? ['failed', t('failed')];
    return { ok: false, error: code, message };
  }
  revalidatePath(revalidate, 'layout');
  return { ok: true, message: done };
}

class Invalid extends Error {}
const must = <T>(v: T | null | undefined | false | ''): T => {
  if (v === null || v === undefined || v === false || v === '') throw new Invalid();
  return v as T;
};
const uuid = (form: FormData, name = 'id') => must(UUID.test(text(form, name)) && text(form, name));

// -- users --------------------------------------------------------------------------------------
export async function suspendAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('suspended'), async () => {
    const hours = Number(text(form, 'hours'));
    await suspendUser(uuid(form), {
      reasonCode: must(oneOf(text(form, 'reasonCode'), SUSPENSION)),
      note: text(form, 'note'),
      ...(hours > 0 ? { hours } : {}),
    });
  });
}

export async function unsuspendAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('unsuspended'), () => unsuspendUser(uuid(form), text(form, 'note')));
}

export async function signOutAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('signedOut'), () => signOutUser(uuid(form), text(form, 'note')));
}

export async function emailAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('emailSent'), () =>
    sendUserEmail(
      uuid(form),
      must(oneOf(text(form, 'action'), ['password_reset', 'verify_email'] as const)),
    ),
  );
}

export async function unlockAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('unlocked'), () => unlockUser(uuid(form)));
}

export async function noteAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('noteAdded'), () =>
    addUserNote(uuid(form), must(text(form, 'body', 2000)), form.get('pinned') === 'on'),
  );
}

export async function rolesAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  const roles = form
    .getAll('roles')
    .map(String)
    .filter((r): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r));
  return run(t('rolesChanged'), () =>
    setStaffRoles(uuid(form), roles, must(text(form, 'note').length >= 3 && text(form, 'note'))),
  );
}

export async function otpResetAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('otpReset'), () => resetOtp(uuid(form), text(form, 'note')));
}

// -- listings, reviews, orders ------------------------------------------------------------------
export async function removeListingAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('listingRemoved'), () =>
    removeAdminListing(
      uuid(form),
      must(oneOf(text(form, 'reasonCode'), REMOVAL)),
      text(form, 'note'),
    ),
  );
}

export async function dismissAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  const ids = form
    .getAll('id')
    .map(String)
    .filter((id) => UUID.test(id));
  return run(t('dismissed'), () =>
    dismissAdminReports(must(ids.length ? ids : null), text(form, 'note')),
  );
}

export async function removeReviewAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('reviewRemoved'), () =>
    removeAdminReview(
      uuid(form),
      must(oneOf(text(form, 'reasonCode'), REVIEW)),
      text(form, 'note'),
    ),
  );
}

export async function refundAction(_: unknown, form: FormData): Promise<ActionResult> {
  const t = await getTranslations('admin.result');
  return run(t('refunded'), () =>
    refundOrder(uuid(form), must(oneOf(text(form, 'reasonCode'), REFUND)), text(form, 'note')),
  );
}

// -- command palette ----------------------------------------------------------------------------
export interface PaletteHit {
  kind: 'user' | 'listing' | 'order';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Finds users, listings and orders for ⌘K, within what the person's roles may open. */
export async function paletteSearch(q: string): Promise<PaletteHit[]> {
  const query = q.trim().slice(0, 100);
  if (query.length < 2 || !(await isAdminHost())) return [];
  const session = await getSession();
  if (!session.authenticated) return [];
  const roles = session.user.roles;
  const idLike = /^[0-9a-f-]{4,36}$/i.test(query);
  const [users, listings, orders, exact] = await Promise.all([
    canOpen('users', roles) ? settle(searchUsers({ q: query, max: 5 })) : null,
    canOpen('listings', roles) ? settle(searchAdminListings({ q: query, limit: 5 })) : null,
    canOpen('orders', roles) && idLike ? settle(searchOrders({ q: query, limit: 5 })) : null,
    canOpen('users', roles) && UUID.test(query) ? settle(getUser(query)) : null,
  ]);
  const hits: PaletteHit[] = [];
  const userHits = exact ? [exact] : (users?.items ?? []);
  for (const u of userHits)
    hits.push({
      kind: 'user',
      id: u.id,
      title: u.name ?? u.email ?? u.id,
      subtitle: [u.email, ...u.staffRoles].filter(Boolean).join(' · '),
      href: `/admin/users/${u.id}`,
    });
  for (const l of listings?.items ?? [])
    hits.push({
      kind: 'listing',
      id: l.id,
      title: l.title,
      subtitle: `${l.sellerName} · ${l.status}`,
      href: `/admin/listings/${l.id}`,
    });
  for (const o of orders?.items ?? [])
    hits.push({
      kind: 'order',
      id: o.id,
      title: `${o.product} · ${(o.amountOre / 100).toFixed(0)} kr`,
      subtitle: `${o.status} · ${o.id.slice(0, 8)}`,
      href: `/admin/orders/${o.id}`,
    });
  return hits;
}
