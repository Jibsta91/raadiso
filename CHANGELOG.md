# Changelog

Notable changes per release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/) as described in [docs/releasing.md](docs/releasing.md).
Each release also has generated notes on GitHub.

## [Unreleased]

### Added

- Service level objectives (ADR-0031): six SLOs over 7 days (website and API availability, page and search
  latency, sign-ins, synthetic journeys) with error budgets and multi-window burn-rate alerts, a Grafana
  **Raadi · SLOs** dashboard and a runbook. A blackbox exporter probes six journeys through the gateway
  every 30 s.
- The status page shows each journey hour by hour for 7 days, how well each promise is kept, and the error
  budget left.
- A security centre on the website (Account → Security and devices): every signed-in device with sign-out
  for one or all others, passkeys (add, sign in with them, remove), the authenticator app, password change
  and a security checkup. Passkey sign-in is enabled on the login page.
- `./raadi doctor` checks the machine before a start (and `./raadi up` runs it); `./raadi status` shows the
  health, memory and CPU of every service.
- An accessibility gate: axe-core checks the main pages, signed-in pages and the console against WCAG 2.2 AA
  in the e2e suite.
- Favourites and saved searches (ADR-0026): a heart on every listing, a Favourites page and app screen, and
  "Save search" on the results. You hear about it (in the app, as a push, and for saved searches at most one
  e-mail a day) when a favourite gets cheaper or is sold, or a saved search has new matches. New service:
  `saved`.
- Search accepts `publishedAfter` and `publishedBefore`.
- Sell from the app: category and subcategory tiles, then the same fields as the website, with photos from
  the camera or the photo library (`expo-image-picker`). The form fields per category now live in
  `@raadi/catalog/attributes`, shared by the website and the app.
- Report a listing (reason and comment) on the website and in the app; moderators work a queue at
  `/moderation`, where removing a listing resolves its reports (ADR-0027).
- Block someone from a conversation: no more messages either way, in any conversation; the blocked person only
  sees that the conversation is closed. Unblock at any time (ADR-0027).

- The admin console at `admin.raadiso.com` (`admin.raadi.localhost` in development), with its own sign-in
  and session (ADR-0028). Staff need a one-time code from an authenticator app. New staff roles `support` and
  `operator` with demo users; moderation moved from the website's `/moderation` into the console.
- An append-only audit log of staff actions (removals, dismissed reports, refunds), readable by platform
  admins in the console. New services: `audit`, and `admin-bff` (the identity-bff image).
- The console got a workspace per role (ADR-0030). Support: find any account and see it across every
  service (listings, orders, reviews, messaging counts, devices, sessions, sign-in events), suspend it with
  a reason and optional expiry, sign it out everywhere, send password-reset or verification e-mails, unlock
  it, and keep internal notes. Moderators: a keyboard-driven workbench (risk-sorted queue, seller history,
  reason codes, bulk dismiss) and review removal. Operators: one page with every service's readiness and
  dependencies, request rate, errors and latency, event lag, dead letters, e-mail and push queues, search
  index drift and firing alerts. Platform admins: refunds, staff roles, authenticator resets, and an audit
  log with charts and CSV export. ⌘K searches users, listings and orders; `g` + a letter switches section.
- Staff APIs (`/admin/v1/…`) accept only the console's tokens, and suspensions, refunds and role changes
  need a sign-in within 15 minutes (RFC 9470 step-up). Audit entries carry what changed (`details`).

- The app's search has each category's own filters (makes, fuel, body type, ranges for year, mileage, area
  and price) in a filter sheet.
- The app has the in-app notifications (Account → Notifications, with the unread count) and public trust
  profiles with ratings and reviews: tap the seller on a listing, or "My public profile". Authors can
  withdraw their own review there, and a review push now opens the profile.
- Reviews from the app: after a sale, the conversation offers to rate the other party, as on the website.
- Edit a listing from the app ("Edit" on your listing, or swipe in My listings): the sell form, filled in,
  with the website's check that nobody changed the listing in the meantime.
- Operations for the Phase 3 features: Marketplace dashboard panels for pushes, the moderation backlog,
  reports, blocks, favourite and saved-search alerts, staff actions, promotion revenue and image clean-up;
  alerts `PushQueueBacklog`, `PushesGivenUp`, `SavedSearchChecksFailing`, `ModerationQueueStale`,
  `ReportsSpike` and `WebSocketOriginRejected`; runbooks for notifications (push), moderation, saved,
  messaging and the audit log. Listings reports the moderation backlog (`raadi.listings.reports_open`,
  `raadi.listings.reports_oldest_age`).

### Changed

- The app's tab bar is Home · Alerts · Sell · Messages · Account: Sell sits in the middle, and the in-app
  notifications are a tab with an unread badge. Search left the tab bar: the home screen's search field and
  categories stay pinned at the top while the listings scroll underneath, and search opens as its own screen.
- E-mails and pushes come in the language chosen on the website or in the app: the choice is saved to the
  profile, and `preferences_changed` events carry the new language (optional field). The app remembers its
  language setting.
- The app shows no push banner for the conversation that is already open.
- The e2e suite signs each demo user in once per run and reuses the sessions, and tests delete the listings
  they create.
- The README, threat model and runbook index cover the Phase 3 services (payments, saved, audit, the admin
  console, push).

### Fixed

- Keycloak's admin console (`auth.<domain>/admin/`) stayed blank: the gateway sent `X-Frame-Options: DENY` on
  Keycloak's pages, which blocked the console's own same-origin frames. Keycloak's routes now allow same-origin
  framing, as Keycloak itself does; the website still cannot be framed.
- Screen readers met an invalid list on the listing page (location and seller); the console's avatars and
  status pills had too little contrast; the moderation queue nested a checkbox inside a list option.
- Traefik could report unhealthy on a busy machine: its health check now has 6 s.
- Users were signed out after `docker compose up` re-ran keycloak-init ("Session doesn't have required
  client"): it recreated every Keycloak client. Clients are now updated in place.
- Refunds asked for a role (`admin`) that did not exist, so nobody could refund. They now need
  `platform-admin` and answer 200.
- A seller without reviews had no public profile (404), so the "No reviews yet" link on listings led
  nowhere. Every seller trust knows now has a profile.
- Removing a review had the same mistake: platform admins could not remove reviews. A moderator's removal is
  now also written to the audit log (`review.remove`).
- `./raadi lint` failed on two shellcheck findings in `./raadi otp` and the smoke test.

## [0.3.0] — 2026-10-04

Phase 3 is done: messaging, notifications (e-mail, push, in-app), reviews and BankID verification, payments
for promoted listings, and the Raadiso app (Expo) with push notifications, tested on an iPhone. This entry
lists the changes since 0.3.0-alpha.2; the alpha entries below cover the rest of the phase.

### Added

- Push notifications in the app: new messages, removed listings, reviews and promotions, sent through Expo's
  push service from the notifications queue. Taps open the right screen, and message pushes can be switched off
  in the app and on the website. Development uses push-mock (`http://push.raadi.localhost/messages`) and stays
  offline (ADR-0025).
- Lint: the Rules of Hooks for the website and the app.
- Category front pages (`/nb/bil`, `/nb/torget`, …) with subcategory tiles and counts, popular searches,
  popular car makes and the newest listings. In the app, category chips open an equivalent screen (ADR-0024).
- Search filters that follow the category: car make, body type, drivetrain and gearbox; property ownership;
  "from – to" ranges for year, mileage, area, bedrooms and guests. Active filters show as removable chips,
  and on phones the filters open as a full-screen sheet.
- More subcategories, following FINN's groups (garden and renovation, antiques and art, animals, vehicle
  equipment, new homes, commercial property, office, industry, hospitality), and optional attributes for body
  type, drivetrain and ownership.
- The app shows a listing's details (key info) and its category path.
- `./raadi dns` and `./raadi cert` manage raadiso.com through GoDaddy's DNS API: A records for a server, and a
  Let's Encrypt wildcard certificate by DNS-01, ready for production (ADR-0023, docs/domain.md).
- Phone mode: `./raadi phone` serves the stack to a phone on the same Wi-Fi as `https://dev.raadiso.com`,
  with LAN DNS through GoDaddy, a Let's Encrypt certificate (DNS-01) and Metro for Expo Go (ADR-0022).
  `./raadi secret-set` stores secrets you supply, behind a hidden prompt.
- App icons (iOS, Android adaptive, web) and a website favicon.
- Mobile app (Expo): home, search, listings, live chat, my listings and account, signing in with OIDC + PKCE
  on devices and through the BFF session in its web build, served under `/m` (ADR-0021).
- "Fjord Glass" look for the app and the website, with bundled fonts and a System / Light / Dark setting
  (the website renders the chosen theme on the server, so pages never flash).

### Changed

- Creating a listing starts by choosing a category, then a subcategory, from tiles; the form is split into
  numbered sections (photos, about, details, price and place), with units shown next to the fields.
- The product is now called **Raadiso**, after its domain raadiso.com: web, app, e-mails, login pages and
  receipts. Code keeps the working name `raadi` (ADR-0023).
- The login and e-mail theme uses the Fjord Glass colours.
- My listings, notifications and profile reviews use the rounded card lists, and unread notifications are
  marked with a dot.
- The website's header has category links and an account menu (My listings, Account, Log out); language and
  appearance moved to the footer.
- Logging out accepts a `returnTo` path, like logging in.

### Fixed

- The native app's requests were rejected (401): the gateway dropped its bearer token when there was no browser
  session. Demo users also lacked `offline_access`, so the app could not stay signed in.
- The identity BFF could reuse a spent refresh token when two requests refreshed at once.

## [0.3.0-alpha.2] — 2026-10-02

Phase 3: payments for promoted listings.

### Added

- Payments: promoted listings (7 or 30 days) paid through provider adapters for Vipps ePayment and Stripe
  Checkout, with idempotent orders, signed webhooks processed exactly once, reconciliation and admin refunds
  (ADR-0020). A Vipps-compatible mock provider runs in development.
- Promoted listings rank first in search and carry a "Promoted" badge; buyers get a receipt e-mail.

### Fixed

- OpenBao's first boot could lose the unseal key on a slow host, because initialisation timed out.

## [0.3.0-alpha.1] — 2026-10-02

Phase 3 so far: messaging, notifications, reviews and trust, and sign-up.

### Added

- Messaging between buyers and sellers, with live delivery over WebSockets (ADR-0016).
- Notifications: queued, throttled e-mail and in-app notices, with an e-mail preference (ADR-0017).
- Reviews and trust: reviews only after a sale between both parties, public trust profiles, BankID
  verification over OIDC with a mock provider in development (ADR-0018).
- Sign-up: Raadi-branded registration, password set after e-mail confirmation, common-password list, terms
  of use, welcome page (ADR-0019).
- Repository: protected `main` (pull requests, required CI, signed commits), issue forms, Playwright MCP for
  AI coding sessions.

### Changed

- Every pinned dependency was upgraded to its newest stable release.
- Event schemas are registered as JSON Schema draft-07, so the registry's compatibility checks work.

### Fixed

- Client-side navigation stalled under parallel load because header links prefetched every page.

## [0.2.0] — 2026-10-01

Phase 2: listings, search (OpenSearch), media (virus-scanned, re-encoded images), authorization (OpenFGA +
OPA), the Kafka event backbone with Debezium outbox, and the web app for browsing, searching and selling.

## [0.1.0] — 2026-10-01

Phase 1: the foundation. A one-command compose stack, Keycloak, OpenBao, the Traefik gateway, the
identity-bff token handler, observability (OpenTelemetry, Prometheus, Loki, Tempo, Grafana), the web shell
in three languages, the toolbox, smoke and e2e tests, and CI.

[Unreleased]: https://github.com/Jibsta91/raadi.com/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Jibsta91/raadi.com/compare/v0.3.0-alpha.2...v0.3.0
[0.3.0-alpha.2]: https://github.com/Jibsta91/raadi.com/compare/v0.3.0-alpha.1...v0.3.0-alpha.2
[0.3.0-alpha.1]: https://github.com/Jibsta91/raadi.com/compare/v0.2.0...v0.3.0-alpha.1
[0.2.0]: https://github.com/Jibsta91/raadi.com/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Jibsta91/raadi.com/releases/tag/v0.1.0
