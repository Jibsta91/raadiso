import 'server-only';
import {
  type ConversationDetail,
  type ConversationPage,
  createIdentityClient,
  createListingsClient,
  createMessagingClient,
  createNotificationsClient,
  createPaymentsClient,
  createSavedClient,
  type FavouritePage,
  type SavedSearch,
  type NotificationList,
  type NotificationPreferences,
  type PaymentOrder,
  type PaymentProduct,
  createSearchClient,
  createTrustClient,
  type Eligibility,
  type Listing,
  type ListingPage,
  type SearchQuery,
  type SearchResult,
  type SecurityOverview,
  type TrustProfile,
  type TrustSummary,
} from '@raadi/api-client';
import { cache } from 'react';
import { env } from './env';
import { logger } from './logger';
import { accessToken } from './session';

/** Server-side data access: internal service URLs, the user's token when signed in. */

export class ServiceUnavailableError extends Error {}

export async function searchListings(query: SearchQuery): Promise<SearchResult> {
  const client = createSearchClient({ baseUrl: env.searchUrl });
  const { data, error, response } = await client.GET('/api/v1/search/listings', {
    params: { query },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (data) return data;
  if (response.status === 400) {
    logger.info({ query, error }, 'search parameters rejected');
    return { total: 0, page: 1, pageSize: 24, items: [], facets: emptyFacets() };
  }
  logger.warn({ status: response.status, error }, 'search failed');
  throw new ServiceUnavailableError('search unavailable');
}

export const getListing = cache(async (id: string): Promise<Listing | null> => {
  const token = await accessToken().catch(() => null);
  const client = createListingsClient({ baseUrl: env.listingsUrl });
  const { data, response } = await client.GET('/api/v1/listings/{id}', {
    params: { path: { id } },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (data) return data;
  if (response.status === 404 || response.status === 400) return null;
  throw new ServiceUnavailableError(`listings returned ${response.status}`);
});

export async function myListings(limit = 50, offset = 0): Promise<ListingPage | null> {
  const token = await accessToken();
  if (!token) return null;
  const client = createListingsClient({ baseUrl: env.listingsUrl });
  const { data, response } = await client.GET('/api/v1/listings/mine', {
    params: { query: { limit, offset } },
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (data) return data;
  throw new ServiceUnavailableError(`listings returned ${response.status}`);
}

/** The signed-in user's conversations; null when signed out. */
export async function inbox(limit = 50): Promise<ConversationPage | null> {
  const token = await accessToken();
  if (!token) return null;
  const client = createMessagingClient({ baseUrl: env.messagingUrl });
  const { data, response } = await client.GET('/api/v1/messaging/conversations', {
    params: { query: { limit } },
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (data) return data;
  throw new ServiceUnavailableError(`messaging returned ${response.status}`);
}

/** One conversation with its latest messages; null if it does not exist for this user. */
export async function conversation(id: string): Promise<ConversationDetail | null> {
  const token = await accessToken();
  if (!token) return null;
  const client = createMessagingClient({ baseUrl: env.messagingUrl });
  const { data, response } = await client.GET('/api/v1/messaging/conversations/{id}', {
    params: { path: { id } },
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (data) return data;
  if (response.status === 404 || response.status === 400) return null;
  throw new ServiceUnavailableError(`messaging returned ${response.status}`);
}

/**
 * Unread messages for the header badge. Never fails the page: a messaging
 * outage just hides the count.
 */
export async function unreadCount(): Promise<number> {
  const token = await accessToken().catch(() => null);
  if (!token) return 0;
  try {
    const client = createMessagingClient({ baseUrl: env.messagingUrl });
    const { data } = await client.GET('/api/v1/messaging/unread', {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return data?.count ?? 0;
  } catch (error) {
    logger.warn({ err: error }, 'unread count unavailable');
    return 0;
  }
}

/** The signed-in user's notifications and e-mail preferences; null when signed out. */
export async function notifications(): Promise<{
  list: NotificationList;
  preferences: NotificationPreferences;
} | null> {
  const token = await accessToken();
  if (!token) return null;
  const client = createNotificationsClient({ baseUrl: env.notificationsUrl });
  const init = {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store' as const,
  };
  const [list, preferences] = await Promise.all([
    client.GET('/api/v1/notifications', { ...init, params: { query: { limit: 50 } } }),
    client.GET('/api/v1/notifications/preferences', init),
  ]);
  if (list.data && preferences.data) return { list: list.data, preferences: preferences.data };
  throw new ServiceUnavailableError(`notifications returned ${list.response.status}`);
}

/** Unread notifications for the header bell (0 on any failure). */
export async function unreadNotifications(): Promise<number> {
  const token = await accessToken().catch(() => null);
  if (!token) return 0;
  try {
    const client = createNotificationsClient({ baseUrl: env.notificationsUrl });
    const { data } = await client.GET('/api/v1/notifications/unread', {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return data?.count ?? 0;
  } catch (error) {
    logger.warn({ err: error }, 'notification count unavailable');
    return 0;
  }
}

/** Trust summary of a listing's seller for the listing page; null if unknown or unavailable. */
export async function sellerTrust(listingId: string): Promise<TrustSummary | null> {
  try {
    const client = createTrustClient({ baseUrl: env.trustUrl });
    const { data } = await client.GET('/api/v1/trust/listings/{id}/seller', {
      params: { path: { id: listingId } },
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return data ?? null;
  } catch (error) {
    logger.warn({ err: error }, 'seller trust unavailable');
    return null;
  }
}

/** A public trust profile; null when the user is unknown. */
export async function trustProfile(userId: string, offset = 0): Promise<TrustProfile | null> {
  const client = createTrustClient({ baseUrl: env.trustUrl });
  const { data, response } = await client.GET('/api/v1/trust/users/{id}', {
    params: { path: { id: userId }, query: { limit: 20, offset } },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (data) return data;
  if (response.status === 404 || response.status === 400) return null;
  throw new ServiceUnavailableError(`trust returned ${response.status}`);
}

/** The signed-in user's verification and rating; null when signed out. */
export async function myTrust(): Promise<TrustSummary | null> {
  const token = await accessToken();
  if (!token) return null;
  const client = createTrustClient({ baseUrl: env.trustUrl });
  const { data, response } = await client.GET('/api/v1/trust/me', {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (data) return data;
  throw new ServiceUnavailableError(`trust returned ${response.status}`);
}

/** Whether the signed-in user may review `subjectId` about a listing (null on any failure). */
export async function reviewEligibility(
  listingId: string,
  subjectId: string,
): Promise<Eligibility | null> {
  const token = await accessToken().catch(() => null);
  if (!token) return null;
  try {
    const client = createTrustClient({ baseUrl: env.trustUrl });
    const { data } = await client.GET('/api/v1/trust/eligibility', {
      params: { query: { listingId, subjectId } },
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return data ?? null;
  } catch (error) {
    logger.warn({ err: error }, 'review eligibility unavailable');
    return null;
  }
}

/** Promotion products and prices (public). */
export async function paymentProducts(): Promise<PaymentProduct[]> {
  const client = createPaymentsClient({ baseUrl: env.paymentsUrl });
  const { data, response } = await client.GET('/api/v1/payments/products', {
    signal: AbortSignal.timeout(3000),
    cache: 'no-store',
  });
  if (data) return data.items;
  throw new ServiceUnavailableError(`payments returned ${response.status}`);
}

/** One of the signed-in user's orders; null when unknown or not theirs. */
export async function paymentOrder(id: string): Promise<PaymentOrder | null> {
  const token = await accessToken();
  if (!token) return null;
  const client = createPaymentsClient({ baseUrl: env.paymentsUrl });
  const { data, response } = await client.GET('/api/v1/payments/orders/{id}', {
    params: { path: { id } },
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (data) return data;
  if (response.status === 404 || response.status === 400) return null;
  throw new ServiceUnavailableError(`payments returned ${response.status}`);
}

function emptyFacets(): SearchResult['facets'] {
  return {
    category: [],
    subcategory: [],
    county: [],
    condition: [],
    fuel: [],
    propertyType: [],
    employmentType: [],
    gearbox: [],
    bodyType: [],
    drivetrain: [],
    ownership: [],
    make: [],
    price: [],
  };
}

/**
 * Ids of the signed-in user's favourites, for hearts on listing cards. Once per
 * request (cards share it); empty when signed out or when saved is down.
 */
export const favouriteIds = cache(async (): Promise<Set<string>> => {
  const token = await accessToken().catch(() => null);
  if (!token) return new Set();
  try {
    const { data } = await createSavedClient({ baseUrl: env.savedUrl }).GET(
      '/api/v1/saved/favourites/ids',
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000),
        cache: 'no-store',
      },
    );
    return new Set(data?.ids ?? []);
  } catch (error) {
    logger.warn({ err: error }, 'favourite ids unavailable');
    return new Set();
  }
});

/** The signed-in user's favourites; null when signed out. */
export async function favourites(offset = 0): Promise<FavouritePage | null> {
  const token = await accessToken();
  if (!token) return null;
  const { data, response } = await createSavedClient({ baseUrl: env.savedUrl }).GET(
    '/api/v1/saved/favourites',
    {
      params: { query: { limit: 48, offset } },
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    },
  );
  if (data) return data;
  throw new ServiceUnavailableError(`saved returned ${response.status}`);
}

/** The signed-in user's saved searches; null when signed out. */
export const savedSearches = cache(async (): Promise<SavedSearch[] | null> => {
  const token = await accessToken();
  if (!token) return null;
  const { data, response } = await createSavedClient({ baseUrl: env.savedUrl }).GET(
    '/api/v1/saved/searches',
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    },
  );
  if (data) return data.items;
  throw new ServiceUnavailableError(`saved returned ${response.status}`);
});

/** Marks a saved search as opened (its "new" count starts again from zero). Best effort. */
export async function markSavedSearchSeen(id: string): Promise<SavedSearch | null> {
  const token = await accessToken();
  if (!token) return null;
  const client = createSavedClient({ baseUrl: env.savedUrl });
  const init = {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
    cache: 'no-store' as const,
  };
  await client
    .POST('/api/v1/saved/searches/{id}/seen', { ...init, params: { path: { id } } })
    .catch(() => undefined);
  return (await savedSearches().catch(() => null))?.find((s) => s.id === id) ?? null;
}

/** My sessions on every device and my sign-in methods (ADR-0031); null when signed out. */
export async function mySecurity(): Promise<SecurityOverview | null> {
  const token = await accessToken();
  if (!token) return null;
  const { data, response } = await createIdentityClient({ baseUrl: env.identityBffUrl }).GET(
    '/api/v1/identity/me/security',
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    },
  );
  if (data) return data;
  if (response.status === 401) return null;
  throw new ServiceUnavailableError(`identity-bff returned ${response.status}`);
}
