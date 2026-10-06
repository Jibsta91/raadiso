# 0030 — Staff APIs for the console, step-up for dangerous actions, and a workspace per role

- Status: Accepted
- Date: 2026-10-05

## Context

ADR-0028 gave the admin console its own host, session, roles, one-time codes and an audit log, but the
console could only show the moderation queue and the audit table. Support could not find an account,
operators had only Grafana, and refunds and review removals were API calls. The plan in ADR-0028 left slices
2–5: users, more moderation, payments and reviews, operations. Staff APIs also need a stronger boundary
than ordinary ones: a stolen website cookie, or an XSS on the website, must not reach them, even when the
person is staff.

## Decision

- **Staff APIs live under `/admin/v1/<service>/…`** in each service that owns the data (listings, payments,
  trust, messaging, notifications, search, audit, and admin-bff for accounts). The gateway routes only
  `/api/v1/…`, so staff APIs are reachable only inside the network, from the console's server.
- **`@Staff(roles, { stepUp })`** in service-kit replaces `@Roles` on them. It requires one of the roles
  **and** a token issued to the console (`azp` = `raadi-admin`); website and app tokens get 403, also for
  platform admins. With `stepUp`, the token's `auth_time` must be within 15 minutes
  (`STEP_UP_MAX_AGE_SECONDS`); otherwise the service answers 401 with an RFC 9470 challenge
  (`WWW-Authenticate: Bearer error="insufficient_user_authentication", max_age=900`). The console then
  offers to sign in again (password and one-time code, `prompt=login`) and returns to the same page. Step-up
  guards suspending and lifting suspensions, refunds, staff roles and removing authenticators.
- **Accounts through admin-bff** (`STAFF_API=true`): a Keycloak service account `admin-bff` with
  `realm-management` view-users, query-users, manage-users, view-events and view-realm, used only on behalf
  of a signed-in staff member. Keycloak stays the system of record for enabled/disabled, sessions,
  credentials and roles; the identity database adds `user_suspensions` (reason code, note, by, until; a
  worker lifts expired ones) and `user_notes` (support's notes, never shown to the user). Support may not act
  on staff accounts, nobody on their own; role changes sign the person out so new roles apply at once.
- **Every change is audited** in the same transaction, now with optional `details` (ids, codes, numbers;
  e.g. roles added and removed, a reason code, an amount; never names or free text about people). Removals,
  dismissals, refunds and suspensions take a reason code and an optional note. Keycloak calls happen inside
  the transaction, last, so a failed call leaves no audit entry for a change that did not happen.
- **One console, a workspace per role** (`apps/web/src/lib/staff.ts`): moderators get the moderation
  workbench (risk-sorted queue, keyboard decisions, seller history, bulk dismiss) plus listings and reviews;
  support gets users (search, a 360° page across every service, suspend, sign out everywhere, account
  e-mails, unlock, notes), listings, orders and reviews; operators get operations (readiness and dependencies
  of every service, golden signals, consumer lag, dead letters, delivery queues, search index drift and
  alerts) from Prometheus, Alertmanager and `/readyz`, numbers only; platform admins get everything plus
  staff roles and the audit log (activity charts, CSV export).
- **Console UX:** ⌘K palette (sections, commands, and live search of users, listings and orders within the
  person's roles), `g` + letter navigation, `?` for shortcuts, toasts, live refresh, light/dark, and the
  sign-in freshness shown in the sidebar.
- **keycloak-init updates clients in place** (PUT, adding missing protocol mappers) instead of a partial
  import with OVERWRITE, which deleted and recreated every client on each run and ended all sessions
  ("Session doesn't have required client").

## Alternatives considered

- **Staff endpoints under `/api/v1` guarded by roles only:** simpler, but a website session of a staff member
  (or an XSS on the website) could drive them; the console's own session would protect nothing.
- **A separate admin BFF that aggregates all services:** one more service to run and keep in step with every
  domain; the console's Next.js server already aggregates, and each service keeps owning its rules.
- **Keycloak's step-up by authentication level (ACR/LoA):** the right tool when there are several factors to
  choose from; every console sign-in already has two, so recency is what matters.
- **Reading Prometheus from the browser or embedding Grafana panels:** exposes the metrics backends to the
  admin host; server-side queries keep them internal and let the page combine sources.
- **Restoring removed listings:** removal fans out (search, media garbage collection, favourites); a restore
  would need its own event and handling in each consumer. Left out until it is needed.

## Consequences

- New Keycloak client and secret (`admin_kc_client_secret`), two identity tables, two listings columns,
  an audit column; regenerated API client and event schema (`details` is optional, so BACKWARD compatible).
- Moderators no longer see e-mail addresses (sellers by name and history only); operators never see user
  data; support never sees message text (counts only).
- Support notes and suspension notes are personal data: they belong to the GDPR export and erasure slice.
- Later: reports about users and messages (a moderation service, ADR-0027), dead-letter replay, and AI
  scores in the moderation workbench (recorded in the audit log with the model and its version).

## Amendment (2026-10-06): no staff powers on the public API

A review found that the older staff routes from ADR-0027 and ADR-0028 were still served under `/api/v1` and
routed by the gateway: the report queue and dismissal (`moderator`), refunds (`platform-admin`) and the audit
log (`platform-admin`). They accepted a website session, so they skipped the console token, step-up and reason
this ADR requires. Listings also projected staff roles onto OpenFGA as contextual tuples on every public
request, so a moderator's website session could delete any listing and a platform admin's could edit one,
without a reason or an audit entry.

- Those routes are gone; the console's `/admin/v1` routes are the only way to do these things. The audit
  service has no public route at all, so the gateway no longer routes `/api/v1/audit/`.
- The public listings API grants nothing for staff roles: only the owner edits or deletes there. Moderators
  remove listings with `POST /admin/v1/listings/{id}/remove`, with a reason and an audit entry.
- `@Roles()` refuses staff roles (moderator, support, operator, platform-admin) when a service starts, so a
  staff role can only be used through `@Staff()`, which demands a console token.
- The smoke test drives staff actions with console tokens and checks that the old routes answer 404 and that
  a moderator's website session cannot delete someone else's listing.
