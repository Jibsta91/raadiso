import 'server-only';
import {
  type AdminListingDetail,
  type AdminListingPage,
  type AdminOrderDetail,
  type AdminOrderPage,
  type AdminReviewPage,
  type AdminUserDetail,
  type AdminUserPage,
  type AdminUser,
  type AuditEntry,
  type AuditStats,
  createAuditClient,
  createIdentityClient,
  createListingsClient,
  createMessagingClient,
  createNotificationsClient,
  createPaymentsClient,
  createSearchClient,
  createTrustClient,
  type IndexStatus,
  type ListingStats,
  type MessagingStats,
  type MessagingUserStats,
  type ModerationDecision,
  type NotificationsUser,
  type PaymentStats,
  type QueueStats,
  type RemovalReason,
  type SellerSnapshot,
  type StaffIdentity,
  type StaffRole,
  type SuspensionReason,
  type UserNote,
  type UserStats,
  type UserTrust,
  type WorkbenchItem,
} from '@raadi/api-client';
import { cache } from 'react';
import { env } from '../env';
import { accessToken } from '../session';

/**
 * The admin console's data access (ADR-0030): the services' /admin/v1 endpoints, called from the
 * console's server with the admin session's token. Services check roles, the console client
 * (azp) and, for dangerous actions, how recent the sign-in is.
 */

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    /** The service asked for a fresh sign-in (RFC 9470 step-up). */
    readonly stepUp = false,
    readonly detail?: string,
  ) {
    super(`admin API returned ${status}${detail ? `: ${detail}` : ''}`);
  }
}

type Init = {
  headers: { authorization: string };
  signal: AbortSignal;
  cache: 'no-store';
};
type Result<T> = { data?: T; error?: unknown; response: Response };

async function call<T>(fn: (init: Init) => Promise<Result<T>>): Promise<T> {
  const token = await accessToken();
  if (!token) throw new AdminApiError(401);
  let res: Result<T>;
  try {
    res = await fn({
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
  } catch {
    throw new AdminApiError(503);
  }
  if (res.response.ok) return res.data as T;
  const challenge = res.response.headers.get('www-authenticate') ?? '';
  const detail = (res.error as { detail?: unknown } | undefined)?.detail;
  throw new AdminApiError(
    res.response.status,
    res.response.status === 401 && challenge.includes('insufficient_user_authentication'),
    typeof detail === 'string' ? detail : undefined,
  );
}

/** For pages: null when the service is down or refuses, so one panel fails, not the page. */
export async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (error) {
    if (error instanceof AdminApiError) return null;
    throw error;
  }
}

const identity = () => createIdentityClient({ baseUrl: env.adminBffUrl });
const listings = () => createListingsClient({ baseUrl: env.listingsUrl });
const payments = () => createPaymentsClient({ baseUrl: env.paymentsUrl });
const trust = () => createTrustClient({ baseUrl: env.trustUrl });
const messaging = () => createMessagingClient({ baseUrl: env.messagingUrl });
const notifications = () => createNotificationsClient({ baseUrl: env.notificationsUrl });
const search = () => createSearchClient({ baseUrl: env.searchUrl });
const auditLog = () => createAuditClient({ baseUrl: env.auditUrl });
const byId = (id: string) => ({ path: { id } });

// -- users (admin-bff) -------------------------------------------------------------------------
export interface UserQuery {
  q?: string;
  role?: StaffRole;
  status?: 'active' | 'suspended';
  first?: number;
  max?: number;
}
export const searchUsers = (query: UserQuery): Promise<AdminUserPage> =>
  call((i) => identity().GET('/admin/v1/users', { ...i, params: { query } }));
export const userStats = (): Promise<UserStats> =>
  call((i) => identity().GET('/admin/v1/users/stats', i));
export const staffMembers = (): Promise<{ items: AdminUser[] }> =>
  call((i) => identity().GET('/admin/v1/users/staff', i));
export const getUser = (id: string): Promise<AdminUserDetail> =>
  call((i) => identity().GET('/admin/v1/users/{id}', { ...i, params: byId(id) }));
export const userNotes = (id: string): Promise<{ items: UserNote[] }> =>
  call((i) => identity().GET('/admin/v1/users/{id}/notes', { ...i, params: byId(id) }));

/** Names of staff members by id (for "who did this"), cached per request. */
export const staffNames = cache(
  async (ids: readonly string[]): Promise<Map<string, StaffIdentity>> => {
    const unique = [...new Set(ids)].slice(0, 50);
    if (!unique.length) return new Map();
    const res = await settle(
      call((i) =>
        identity().GET('/admin/v1/users/lookup', {
          ...i,
          params: { query: { ids: unique.join(',') } },
        }),
      ),
    );
    return new Map((res?.items ?? []).map((s) => [s.id, s]));
  },
);

export const suspendUser = (
  id: string,
  body: { reasonCode: SuspensionReason; note?: string; hours?: number },
) => call((i) => identity().POST('/admin/v1/users/{id}/suspend', { ...i, params: byId(id), body }));
export const unsuspendUser = (id: string, note: string) =>
  call((i) =>
    identity().POST('/admin/v1/users/{id}/unsuspend', { ...i, params: byId(id), body: { note } }),
  );
export const signOutUser = (id: string, note: string) =>
  call((i) =>
    identity().POST('/admin/v1/users/{id}/sign-out', { ...i, params: byId(id), body: { note } }),
  );
export const sendUserEmail = (id: string, action: 'password_reset' | 'verify_email') =>
  call((i) =>
    identity().POST('/admin/v1/users/{id}/emails', { ...i, params: byId(id), body: { action } }),
  );
export const unlockUser = (id: string) =>
  call((i) => identity().POST('/admin/v1/users/{id}/unlock', { ...i, params: byId(id) }));
export const addUserNote = (id: string, body: string, pinned: boolean) =>
  call((i) =>
    identity().POST('/admin/v1/users/{id}/notes', {
      ...i,
      params: byId(id),
      body: { body, pinned },
    }),
  );
export const setStaffRoles = (id: string, roles: StaffRole[], note: string) =>
  call((i) =>
    identity().PUT('/admin/v1/users/{id}/roles', {
      ...i,
      params: byId(id),
      body: { roles, note },
    }),
  );
export const resetOtp = (id: string, note: string) =>
  call((i) =>
    identity().POST('/admin/v1/users/{id}/otp-reset', { ...i, params: byId(id), body: { note } }),
  );

// -- listings -----------------------------------------------------------------------------------
export interface ListingQuery {
  q?: string;
  owner?: string;
  status?: 'active' | 'sold' | 'deleted';
  category?: string;
  reported?: 'true' | 'false';
  limit?: number;
  offset?: number;
}
export const searchAdminListings = (query: ListingQuery): Promise<AdminListingPage> =>
  call((i) => listings().GET('/admin/v1/listings', { ...i, params: { query } }));
export const listingStats = (): Promise<ListingStats> =>
  call((i) => listings().GET('/admin/v1/listings/stats', i));
export const workbench = (): Promise<{ items: WorkbenchItem[] }> =>
  call((i) => listings().GET('/admin/v1/listings/workbench', { ...i, params: { query: {} } }));
export const moderationHistory = (handledBy?: string): Promise<{ items: ModerationDecision[] }> =>
  call((i) =>
    listings().GET('/admin/v1/listings/history', {
      ...i,
      params: { query: handledBy ? { handledBy } : {} },
    }),
  );
export const sellerSnapshot = (id: string): Promise<SellerSnapshot> =>
  call((i) => listings().GET('/admin/v1/listings/sellers/{id}', { ...i, params: byId(id) }));
export const getAdminListing = (id: string): Promise<AdminListingDetail> =>
  call((i) => listings().GET('/admin/v1/listings/{id}', { ...i, params: byId(id) }));
export const removeAdminListing = (id: string, reasonCode: RemovalReason, note: string) =>
  call((i) =>
    listings().POST('/admin/v1/listings/{id}/remove', {
      ...i,
      params: byId(id),
      body: { reasonCode, note },
    }),
  );
export const dismissAdminReports = (ids: string[], note: string) =>
  call((i) => listings().POST('/admin/v1/listings/dismiss', { ...i, body: { ids, note } }));

// -- payments -----------------------------------------------------------------------------------
export interface OrderQuery {
  q?: string;
  user?: string;
  listing?: string;
  status?: AdminOrderDetail['status'];
  limit?: number;
  offset?: number;
}
export const searchOrders = (query: OrderQuery): Promise<AdminOrderPage> =>
  call((i) => payments().GET('/admin/v1/payments/orders', { ...i, params: { query } }));
export const paymentStats = (): Promise<PaymentStats> =>
  call((i) => payments().GET('/admin/v1/payments/stats', i));
export const getOrder = (id: string): Promise<AdminOrderDetail> =>
  call((i) => payments().GET('/admin/v1/payments/orders/{id}', { ...i, params: byId(id) }));
export type RefundReason =
  'customer_request' | 'duplicate' | 'service_failure' | 'fraud' | 'goodwill' | 'other';
export const refundOrder = (id: string, reasonCode: RefundReason, note: string) =>
  call((i) =>
    payments().POST('/admin/v1/payments/orders/{id}/refund', {
      ...i,
      params: byId(id),
      body: { reasonCode, note },
    }),
  );

// -- trust --------------------------------------------------------------------------------------
export interface ReviewQuery {
  user?: string;
  as?: 'about' | 'by';
  rating?: number;
  removed?: 'true' | 'false';
  limit?: number;
  offset?: number;
}
export const searchReviews = (query: ReviewQuery): Promise<AdminReviewPage> =>
  call((i) => trust().GET('/admin/v1/trust/reviews', { ...i, params: { query } }));
export const userTrust = (id: string): Promise<UserTrust> =>
  call((i) => trust().GET('/admin/v1/trust/users/{id}', { ...i, params: byId(id) }));
export type ReviewRemovalReason =
  'abusive' | 'personal_data' | 'not_genuine' | 'off_topic' | 'other';
export const removeAdminReview = (id: string, reasonCode: ReviewRemovalReason, note: string) =>
  call((i) =>
    trust().POST('/admin/v1/trust/reviews/{id}/remove', {
      ...i,
      params: byId(id),
      body: { reasonCode, note },
    }),
  );

// -- messaging, notifications, search ------------------------------------------------------------
export const messagingUser = (id: string): Promise<MessagingUserStats> =>
  call((i) => messaging().GET('/admin/v1/messaging/users/{id}', { ...i, params: byId(id) }));
export const messagingStats = (): Promise<MessagingStats> =>
  call((i) => messaging().GET('/admin/v1/messaging/stats', i));
export const notificationsUser = (id: string): Promise<NotificationsUser> =>
  call((i) =>
    notifications().GET('/admin/v1/notifications/users/{id}', { ...i, params: byId(id) }),
  );
export const notificationQueues = (): Promise<QueueStats> =>
  call((i) => notifications().GET('/admin/v1/notifications/queues', i));
export const indexStatus = (): Promise<IndexStatus> =>
  call((i) => search().GET('/admin/v1/search/index', i));

// -- audit --------------------------------------------------------------------------------------
export interface AuditQuery {
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  before?: string;
  limit?: number;
}
export const adminAudit = (query: AuditQuery): Promise<{ items: AuditEntry[]; hasMore: boolean }> =>
  call((i) => auditLog().GET('/admin/v1/audit/entries', { ...i, params: { query } }));
export const auditStats = (days = 14): Promise<AuditStats> =>
  call((i) => auditLog().GET('/admin/v1/audit/stats', { ...i, params: { query: { days } } }));
