# 0028 — Admin console: own host and session, staff roles, one-time codes, append-only audit log

- Status: Accepted
- Date: 2026-10-04

## Context

Staff work so far was a moderation page on the public website for the `moderator` role, and admin APIs that
only the `platform-admin` role could call with tools. Running the marketplace needs customer service and
operations people too, a console they can work in, and a record of what staff did. A staff session should be
harder to steal and easier to contain than an ordinary user's.

## Decision

- **Staff roles** in the Raadi realm: `moderator` (listings and reports), `support` (customer service),
  `operator` (operations) and `platform-admin` (everything, including refunds and the audit log). They are
  separate roles; a person can hold several. Services check the role they need with `@Roles`, and refunds now
  need `platform-admin` (the role `admin` that payments asked for did not exist).
- **The console has its own host**, `admin.<domain>` (`admin.raadi.localhost` in development,
  `admin.raadiso.com` in production), served by the same Next.js app:
  - The `/[locale]/admin` area answers only on the admin host, and the admin host answers only that area
    (other paths redirect to it). The website answers 404 for admin paths, and `/moderation` there redirects
    to the console.
  - The host has no API routes. The console's reads are server-rendered and its actions are server actions,
    both using the console session's token. Traefik adds `X-Robots-Tag: noindex` and `Cache-Control:
no-store`.
  - Sections are shown and opened by role (`apps/web/src/lib/staff.ts`): Overview for all staff, Moderation
    for moderators and platform admins, Audit for platform admins. Services enforce the same roles again.
- **A separate session**: `admin-bff` is a second instance of the identity-bff image with its own Keycloak
  client (`raadi-admin`, no offline access), cookie, Valkey key prefix (`SESSION_KEY_PREFIX`), OpenBao path
  and session key. A website session never opens the console and the other way round, and signing out of
  one leaves the other alone. The console logs in with `prompt=login` (`OIDC_PROMPT`), so the website's
  Keycloak SSO session does not sign staff in silently.
- **One-time codes for the console**: the client `raadi-admin` uses the Keycloak flow `raadi-admin-browser`,
  a copy of the browser flow with the OTP step required. keycloak-init creates and binds it through the Admin
  REST API, because partial imports do not change flows in existing realms. Staff who have an authenticator
  are also asked for a code on the website, by Keycloak's standard conditional OTP. In development, the demo
  staff users have a pre-registered authenticator whose secret is `DEMO_OTP_SECRET`, and smoke and e2e
  compute the codes.
- **An append-only audit log**: services write `no.raadi.audit.action.v1` (actor id and staff roles, a dotted
  action, target type and id, optional reason, time) to their outbox in the same transaction as the change,
  with service-kit's `audit()`. A new `audit` service consumes `raadi.audit.events` (30-day retention in
  Kafka) into a table whose triggers refuse UPDATE, DELETE and TRUNCATE, and serves
  the entries to platform admins (`GET /admin/v1/audit/entries` since ADR-0030; first under `/api/v1`), filtered by actor, action, target and time. Today it records
  removals by moderators, dismissed reports and refunds.

## Alternatives considered

- **The console as a path on the website** (`/admin` with the user's session): no new host or BFF, but staff
  then browse the public site with an all-powerful cookie, and one XSS on the website reaches the console.
- **A separate admin app** (for example react-admin): a second frontend to build and maintain, without the
  website's components, translations and API client.
- **Keycloak's own admin console for staff**: it manages identities, not listings, reports or payments, and
  it would give staff far more power over the realm than they need.
- **Audit entries written by each service to its own table**: no outbox or new service, but a platform admin
  would query every service, and the entries would sit in databases the services can change.
- **WebAuthn instead of TOTP**: phishing-resistant and the better long-term choice for staff, but hard to
  automate in smoke and e2e today. Passkeys stay available, and the flow can require them later.

## Consequences

- Two new containers, `admin-bff` (≈ 120 MB) and `audit` (≈ 130 MB), each with a 192 MB limit
  ([ADR-0011](0011-resource-budget.md)).
- Production needs the admin host in DNS and its certificate (the Let's Encrypt certificate covers the
  wildcard), and staff must register an authenticator before their first console login. `DEMO_OTP_SECRET` is
  for development and demo data only.
- Audit entries hold staff ids and the ids of what they changed, never names, comments or other personal
  data. Retention and export of the audit table belong to the GDPR slice.
- Later slices build on this: user search, suspension and roles for support (slice 2), more moderation
  tools (3), payments and reviews (4), operations (health, queues, dead letters, reindex) for operators (5)
  and GDPR requests (6). Each new staff action writes an audit entry.
