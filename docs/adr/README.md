# Architecture Decision Records

Short records of significant decisions ([format](0001-record-architecture-decisions.md)). New ADRs take the next
number; superseded ADRs stay in place with a link to their replacement.

| #                                                             | Decision                                                                                 | Status   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                 | Record architecture decisions                                                            | Accepted |
| [0002](0002-typescript-nestjs-and-python.md)                  | TypeScript (NestJS) for domain services, Python for AI                                   | Accepted |
| [0003](0003-single-compose-project.md)                        | One Compose project for laptop and cloud                                                 | Accepted |
| [0004](0004-token-handler-bff.md)                             | Token-handler BFF and zero-trust JWT validation                                          | Accepted |
| [0005](0005-secrets-bootstrap-openbao.md)                     | First-boot secrets, OpenBao AppRole, single-key unseal                                   | Accepted |
| [0006](0006-gateway-file-provider-and-dev-tls.md)             | Traefik with file provider, `*.localhost`, local dev CA                                  | Accepted |
| [0007](0007-observability-pipeline.md)                        | OpenTelemetry everywhere through one collector                                           | Accepted |
| [0008](0008-database-per-service-and-outbox.md)               | Database per service, dbmate migrations, transactional outbox                            | Accepted |
| [0009](0009-open-source-licensing-policy.md)                  | Licensing policy: free, OSI first                                                        | Accepted |
| [0010](0010-pinned-versions.md)                               | Version pinning and deliberate version choices                                           | Accepted |
| [0011](0011-resource-budget.md)                               | 16 GB laptop resource budget and profiles                                                | Accepted |
| [0012](0012-event-backbone.md)                                | Event backbone: Kafka, Debezium outbox, Apicurio contracts                               | Accepted |
| [0013](0013-authorization.md)                                 | Authorization: OpenFGA relationships, OPA rules, fail closed                             | Accepted |
| [0014](0014-media-pipeline.md)                                | Media pipeline: scan, re-encode, signed URLs, orphan GC                                  | Accepted |
| [0015](0015-search.md)                                        | Search: OpenSearch fed by listing events                                                 | Accepted |
| [0016](0016-messaging.md)                                     | Messaging: REST to send, WebSocket to push, participants on the row                      | Accepted |
| [0017](0017-notifications.md)                                 | Notifications: events in, queued e-mail out, addresses looked up at send time            | Accepted |
| [0018](0018-reviews-and-trust.md)                             | Reviews only after a real deal; BankID over OIDC, no national ID stored                  | Accepted |
| [0019](0019-sign-up.md)                                       | Sign-up: Keycloak's hosted registration with a Raadi theme                               | Accepted |
| [0020](0020-payments.md)                                      | Payments: provider adapters, idempotent orders, signed webhooks, reconciliation          | Accepted |
| [0021](0021-mobile-app-and-fjord-glass.md)                    | Mobile app (Expo, per-platform sign-in, web build under /m); Fjord Glass look            | Accepted |
| [0022](0022-phone-mode.md)                                    | Phone mode: own domain on the LAN, Let's Encrypt via DNS-01, Metro for Expo Go           | Accepted |
| [0023](0023-domain-dns-and-tls.md)                            | Domain raadiso.com at GoDaddy, Let's Encrypt by DNS-01; brand "Raadiso"                  | Accepted |
| [0024](0024-category-pages-and-filters.md)                    | Categories like FINN: category pages, filters per category, guided new listing           | Accepted |
| [0025](0025-push-notifications.md)                            | Push notifications: Expo push behind the notifications queue, local mock                 | Accepted |
| [0026](0026-favourites-and-saved-searches.md)                 | Favourites and saved searches: a `saved` service, alerts as events                       | Accepted |
| [0027](0027-reports-and-blocking.md)                          | Reports and blocking: listings' moderators' queue, blocks in messaging                   | Accepted |
| [0028](0028-admin-console-staff-roles-and-audit.md)           | Admin console: own host and session, staff roles, one-time codes, audit log              | Accepted |
| [0029](0029-ios-native-look.md)                               | The iOS app uses Apple's native components (Liquid Glass, SF Symbols, SwiftUI, widget)   | Accepted |
| [0030](0030-staff-apis-and-console-workspaces.md)             | Staff APIs (console tokens only, step-up), a console workspace per role                  | Accepted |
| [0031](0031-foundation-slos-security-centre-doctor.md)        | Foundation revisited: SLOs and journey probes, security centre, doctor, accessibility    | Accepted |
| [0032](0032-multi-country-marketplace.md)                     | One marketplace for many countries; country separate from language                       | Accepted |
| [0033](0033-horumar-group-and-somaliland-first.md)            | Horumar Group owns Raadiso; Somaliland is the first market                               | Accepted |
| [0034](0034-tunnel-mode-pangolin.md)                          | Tunnel mode: Pangolin on the laptop for public access and a VPN                          | Accepted |
| [0035](0035-crowdsec-waf-at-the-tunnel-edge.md)               | CrowdSec as a WAF at the tunnel's edge (no IP bans yet)                                  | Accepted |
| [0036](0036-self-hosted-ci-runner.md)                         | CI on a self-hosted runner on the development laptop                                     | Accepted |
| [0037](0037-renovate-dependency-updates.md)                   | Renovate for dependency updates, self-hosted                                             | Accepted |
| [0038](0038-error-reports-glitchtip.md)                       | Error reports from the website and the app: GlitchTip                                    | Accepted |
| [0040](0040-countries-money-and-taxonomy-as-data.md)          | Countries in the data: money in minor units, regions, a taxonomy per country             | Accepted |
| [0041](0041-search-2-understanding-relevance-autocomplete.md) | Search 2.0: query understanding, multilingual matching, measured relevance, autocomplete | Accepted |
| [0042](0042-best-match-ranking-and-sorts.md)                  | Best match: quality and freshness in the ranking, sorts per category, a ranking lab      | Accepted |
| [0043](0043-price-insight-and-guide.md)                       | Price insight: deal ratings against comparable listings, a price guide for sellers       | Accepted |
| [0044](0044-price-history-and-drops.md)                       | Price history and drops: recorded by listings, carried by events, found in search        | Accepted |
| [0045](0045-seller-tools.md)                                  | Seller tools: a completeness meter, photo order, drafts, renewing, view counts           | Accepted |
| [0046](0046-smart-categories.md)                              | Smart categories: a third level, categories from what is sold, reduced per category      | Accepted |
| [0047](0047-similar-and-recently-viewed.md)                   | Discovery: similar listings from search, recently viewed in the browser                  | Accepted |
| [0048](0048-app-2-home-cards-photos.md)                       | App 2.0: a FINN-style front page, cards with a heart, full-screen photos, grid or list   | Accepted |
| [0049](0049-testflight-over-the-tunnel.md)                    | TestFlight before production: the app built for the tunnel, used over the Pangolin VPN   | Accepted |
