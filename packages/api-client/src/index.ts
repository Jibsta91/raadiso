import createClient, { type ClientOptions } from 'openapi-fetch';
import type {
  components as IdentityComponents,
  paths as IdentityPaths,
} from './generated/identity';
import type {
  components as ListingsComponents,
  paths as ListingsPaths,
} from './generated/listings';
import type { components as MediaComponents, paths as MediaPaths } from './generated/media';
import type {
  components as MessagingComponents,
  paths as MessagingPaths,
} from './generated/messaging';
import type {
  components as NotificationsComponents,
  paths as NotificationsPaths,
} from './generated/notifications';
import type { components as SearchComponents, paths as SearchPaths } from './generated/search';
import type {
  components as PaymentsComponents,
  paths as PaymentsPaths,
} from './generated/payments';
import type { components as AuditComponents, paths as AuditPaths } from './generated/audit';
import type { components as SavedComponents, paths as SavedPaths } from './generated/saved';
import type { components as TrustComponents, paths as TrustPaths } from './generated/trust';

export type {
  AuditPaths,
  IdentityPaths,
  ListingsPaths,
  MediaPaths,
  MessagingPaths,
  NotificationsPaths,
  PaymentsPaths,
  SavedPaths,
  SearchPaths,
  TrustPaths,
};

// Identity
export type Me = IdentityComponents['schemas']['Me'];
export type Session = IdentityComponents['schemas']['Session'];
export type SessionUser = IdentityComponents['schemas']['SessionUser'];
export type UpdateMe = IdentityComponents['schemas']['UpdateMe'];
export type Locale = IdentityComponents['schemas']['Locale'];
export type Problem = IdentityComponents['schemas']['Problem'];

// Listings
export type Listing = ListingsComponents['schemas']['Listing'];
export type ListingPage = ListingsComponents['schemas']['ListingPage'];
export type CreateListing = ListingsComponents['schemas']['CreateListing'];
export type UpdateListing = ListingsComponents['schemas']['UpdateListing'];

// Search
export type SearchResult = SearchComponents['schemas']['SearchResult'];
export type SearchHit = SearchComponents['schemas']['SearchHit'];
export type FacetValue = SearchComponents['schemas']['FacetValue'];
export type SearchQuery = NonNullable<
  SearchPaths['/api/v1/search/listings']['get']['parameters']['query']
>;

// Media
export type Media = MediaComponents['schemas']['Media'];

// Messaging
export type Conversation = MessagingComponents['schemas']['Conversation'];
export type ConversationDetail = MessagingComponents['schemas']['ConversationDetail'];
export type ConversationPage = MessagingComponents['schemas']['ConversationPage'];
export type Message = MessagingComponents['schemas']['Message'];
export type StartedConversation = MessagingComponents['schemas']['StartedConversation'];

// Notifications
export type Notification = NotificationsComponents['schemas']['Notification'];
export type NotificationList = NotificationsComponents['schemas']['NotificationList'];
export type NotificationPreferences = NotificationsComponents['schemas']['Preferences'];

// Trust (reviews and verification)
export type TrustSummary = TrustComponents['schemas']['TrustSummary'];
export type TrustProfile = TrustComponents['schemas']['Profile'];
export type Review = TrustComponents['schemas']['Review'];
export type ReviewInput = TrustComponents['schemas']['ReviewInput'];
export type RatingSummary = TrustComponents['schemas']['RatingSummary'];
export type Eligibility = TrustComponents['schemas']['Eligibility'];

// Saved (favourites and saved searches)
export type Favourite = SavedComponents['schemas']['Favourite'];
export type FavouritePage = SavedComponents['schemas']['FavouritePage'];
export type SavedSearch = SavedComponents['schemas']['SavedSearch'];
export type SavedSearchInput = SavedComponents['schemas']['SavedSearchInput'];

// Audit (staff actions)
export type AuditEntry = AuditComponents['schemas']['AuditEntry'];

// Payments (promoted listings)
export type PaymentProduct = PaymentsComponents['schemas']['Product'];
export type PaymentOrder = PaymentsComponents['schemas']['Order'];
export type PaymentOrderInput = PaymentsComponents['schemas']['OrderInput'];

/*
 * Typed clients shared by web and mobile:
 *   - web (server side): baseUrl = the service (internal) or the gateway
 *   - browsers and mobile: baseUrl = the public origin; the gateway routes by path
 */
export const createIdentityClient = (options: ClientOptions) =>
  createClient<IdentityPaths>(options);
export const createListingsClient = (options: ClientOptions) =>
  createClient<ListingsPaths>(options);
export const createSearchClient = (options: ClientOptions) => createClient<SearchPaths>(options);
export const createMediaClient = (options: ClientOptions) => createClient<MediaPaths>(options);
export const createMessagingClient = (options: ClientOptions) =>
  createClient<MessagingPaths>(options);
export const createNotificationsClient = (options: ClientOptions) =>
  createClient<NotificationsPaths>(options);
export const createTrustClient = (options: ClientOptions) => createClient<TrustPaths>(options);
export const createPaymentsClient = (options: ClientOptions) =>
  createClient<PaymentsPaths>(options);
export const createSavedClient = (options: ClientOptions) => createClient<SavedPaths>(options);
export const createAuditClient = (options: ClientOptions) => createClient<AuditPaths>(options);
