# Roadmap

Each phase ends with `docker compose up` green: the smoke test, Playwright E2E and the quality gates all pass.

| Phase                                   | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Foundation**                       | Monorepo, compose stack with init containers, toolbox, Keycloak realm, PostgreSQL (PostGIS + pgvector), Valkey, OpenBao, Traefik gateway, OTel + Prometheus/Alertmanager/Loki/Tempo/Grafana, identity-bff (token handler), web shell (nb/en/so), dev hot reload, smoke + E2E tests, CI                                                                                                                                                                                                                                                                           | ✅ Done                                                                                                                                                                                                                                                                                                                                                   |
| **2. Listings, search, media, web**     | Kafka (KRaft) + Apicurio + Debezium outbox, OpenSearch, SeaweedFS + imgproxy, ClamAV, OpenFGA + OPA. Services: listings, search, media. Seed data (~500 listings with images). Web: browse, search (full-text, facets, geo radius), listing detail, create/edit listing                                                                                                                                                                                                                                                                                          | ✅ Done                                                                                                                                                                                                                                                                                                                                                   |
| **3. Messaging, notifications, mobile** | messaging (WebSockets), notifications (e-mail, Expo push, in-app), payments (mock + Vipps/Stripe stubs), reviews/trust (BankID mock). Expo app (Expo Router) sharing `@raadi/api-client`, Expo dev server in a container (LAN/tunnel)                                                                                                                                                                                                                                                                                                                            | ✅ Done (v0.3.0): messaging, notifications (e-mail, Expo push, in-app), reviews/trust, sign-up, payments, Expo app (iPhone via Expo Go, web build under /m). Since then (unreleased): favourites and saved searches, reports and blocking, admin console with staff roles, one-time codes and audit log, selling from the app, iOS native look and widget |
| **4. AI pillars**                       | Ollama + LiteLLM + Langfuse, MLflow. AI Governance (OPA, audit log, Presidio, GDPR export/erasure, guardrails, review queues), AI Cybersecurity (fraud/scam/ATO detection, log anomalies, SOC assistant), AI Data Management (Dagster, lakehouse, Soda, OpenLineage, enrichment, OpenMetadata under `--profile full`), AI IaC Ops (plan review, sizing, drift, backup checks, runbooks). Also the carry-overs below                                                                                                                                              | Planned; domain raadiso.com DNS and Let's Encrypt tooling ready (ADR-0023)                                                                                                                                                                                                                                                                                |
| **5. CI/CD & cloud**                    | `compose.prod.yaml`, multi-arch builds to GHCR with SBOM, Cosign and SLSA provenance, OpenTofu modules (Hetzner/AWS examples), cloud-init, Ansible hardening, Provision and Deploy workflows with rollback, restic backups + tested restore, `docs/deploy.md`. Raadi MCP server (OAuth via Keycloak, read and write tool scopes, audit log), after the deployment because MCP clients need a public HTTPS endpoint. App releases: EAS production profile, TestFlight and Play internal testing, store listings and privacy labels (they need the public backend) | Planned                                                                                                                                                                                                                                                                                                                                                   |
| **6. Hardening & docs**                 | CrowdSec + Coraza WAF (OWASP CRS), nonce-based CSP, ASVS L2 checklist, revoke the OpenBao root token, ZAP baseline in CI, documentation pass                                                                                                                                                                                                                                                                                                                                                                                                                     | Planned                                                                                                                                                                                                                                                                                                                                                   |

## Phase 4: carry-overs and plan notes

Phases 2 and 3 deferred work to Phase 4 in their ADRs. It is collected here so the phase gate covers it.

**Before the AI work starts** (admin console slices from
[ADR-0028](adr/0028-admin-console-staff-roles-and-audit.md); AI review queues are worked in the console):

- Slice 2: user search, suspension and support roles. Slice 3: more moderation tools (reports about users
  and messages, not only listings). Move the report queue out of listings into a moderation service when
  reports cover more than listings ([ADR-0027](adr/0027-reports-and-blocking.md)).
- Slice 4: payments and reviews in the console (refunds and review removal there, not only by API or on the
  public profile). Slice 5: operations for operators (health, queues, dead letters, reindex).
- Every new staff action writes an audit entry. AI decisions that change something (hide, flag, score) are
  recorded in the same audit service, with the model and its version, so the log stays the single record.

**AI Governance: GDPR export, erasure and retention** (slice 6). Each store, with its owner ADR:

| Data                             | Where                                                                                             | Erasure / retention to decide                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Account, profile, language       | Keycloak, identity-bff                                                                            | Delete; sessions and refresh tokens revoked                                     |
| Listings, images                 | listings, media (SeaweedFS), OpenSearch                                                           | Delete, remove from the index, delete objects and imgproxy cache                |
| Messages, blocks                 | messaging ([ADR-0016](adr/0016-messaging.md), [ADR-0027](adr/0027-reports-and-blocking.md))       | The other party keeps the conversation; the leaving side's text and name go     |
| E-mail and push log, push tokens | notifications ([ADR-0017](adr/0017-notifications.md), [ADR-0025](adr/0025-push-notifications.md)) | Tokens deleted; logs on a retention timer                                       |
| Reviews, BankID verification     | trust ([ADR-0018](adr/0018-reviews-and-trust.md))                                                 | Reviews written by the user anonymised; verification hash deleted               |
| Favourites, saved searches       | saved ([ADR-0026](adr/0026-favourites-and-saved-searches.md))                                     | Delete                                                                          |
| Report comments                  | listings ([ADR-0027](adr/0027-reports-and-blocking.md))                                           | Retention after the report is closed                                            |
| Orders and receipts              | payments ([ADR-0020](adr/0020-payments.md))                                                       | Kept for the bookkeeping period (Norwegian accounting law), then deleted        |
| Audit entries (staff ids)        | audit ([ADR-0028](adr/0028-admin-console-staff-roles-and-audit.md))                               | Retention period; export for the staff member                                   |
| Logs, traces, LLM traces         | Loki, Tempo, Langfuse                                                                             | Retention timers; prompts must not hold personal data (Presidio before logging) |

Account deletion is self-service on the website **and in the app**: app stores require in-app deletion for
apps that create accounts, so it is a precondition for the Phase 5 store release. Export is one archive per
user, assembled from every service through an internal API, with an audit entry.

**AI Cybersecurity:**

- Scam and spam scoring of message text ([ADR-0016](adr/0016-messaging.md)) and listing text, feeding the
  moderation queue as scores. A person decides; no automatic removal by report counts
  ([ADR-0027](adr/0027-reports-and-blocking.md)). Decisions with legal or similar effect on a user keep a
  human in the loop and an explanation the user can see (GDPR Art. 22, EU AI Act transparency).
- Account-takeover signals from Keycloak events and the patterns in
  [auth-anomalies.md](runbooks/auth-anomalies.md); payment fraud signals from payments.

**AI Data Management:** embeddings for similar listings and semantic search in OpenSearch k-NN
([ADR-0015](adr/0015-search.md)) or pgvector (installed since Phase 1, unused). Saved searches move to a
percolator if checking them becomes a cost ([ADR-0026](adr/0026-favourites-and-saved-searches.md)).

**Cross-cutting for the phase gate:**

- An offline LLM mock (like payments-mock and push-mock) so smoke, e2e and CI stay deterministic and do not
  need a model download. Real models run under a profile.
- The budget ([ADR-0011](adr/0011-resource-budget.md)): the default profile is at ≈ 6.7 GB. Ollama with a
  3–4B model, LiteLLM, Langfuse (v3 needs ClickHouse) and MLflow do not all fit; decide what is default and
  what is `--profile ai` / `--profile full` in the pillar ADRs.
- Untrusted text (listings, messages, reports) reaches the models: prompt injection, data exfiltration
  through tool calls and output handling go into the threat model, with guardrail tests.
- Somali and Norwegian quality: an evaluation set per language for every model-backed feature, tracked in
  Langfuse or MLflow.
- Python dependencies get the license gate ([ADR-0009](adr/0009-open-source-licensing-policy.md)); LiteLLM and
  Langfuse only in their OSI-licensed form.
