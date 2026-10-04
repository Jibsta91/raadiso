# 0011 — 16 GB laptop resource budget and profiles

- Status: Accepted
- Date: 2026-10-01

## Decision

Every container has a memory limit (`deploy.resources.limits`). Go services also get a `GOMEMLIMIT` and the
JVM a `MaxRAMPercentage`, so they stay under their limits. The default profile must leave room for the host OS,
an IDE and a browser on a 16 GB laptop (Docker Desktop with ~8–10 GB).

| Phase                        | Measured steady-state RSS (default profile)                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1                            | ≈ 1.9 GB across 15 containers (Keycloak ≈ 600 MB is the largest)                                                               |
| 2                            | ≈ 5.8 GB across 28 containers (ClamAV ≈ 950 MB, OpenSearch ≈ 660 MB, Keycloak ≈ 600 MB, Kafka Connect and Kafka ≈ 420 MB each) |
| 3 (messaging, notifications) | ≈ 6.0 GB across 30 containers (messaging ≈ 120 MB, notifications ≈ 150 MB, Valkey and Mailpit ≈ 10 MB each)                    |
| 3 (+ trust)                  | ≈ 6.2 GB across 31 containers (trust ≈ 150 MB; the BankID mock is a realm in the existing Keycloak, no new container)          |
| 3 (+ payments)               | ≈ 6.3 GB across 33 containers (payments ≈ 115 MB, payments-mock ≈ 110 MB; the mock runs in development only)                   |
| 3 (+ mobile web)             | ≈ 6.4 GB across 34 containers (mobile-web ≈ 60 MB of its 96 MB limit)                                                          |
| 3 (+ push)                   | ≈ 6.5 GB across 35 containers (push-mock ≈ 70 MB of its 128 MB limit, development only; notifications ≈ 145 MB)                |
| 3 (+ saved)                  | ≈ 6.7 GB across 36 containers (saved ≈ 180 MB of its 256 MB limit)                                                             |
| 3 (+ admin console)          | ≈ 6.7 GB across 38 containers (admin-bff ≈ 120 MB and audit ≈ 130 MB, each of a 192 MB limit)                                  |

Later phases add Kafka, OpenSearch and Ollama, the expensive ones. They get tight limits and small defaults (a
3–4B instruct model, small JVM heaps). Heavy extras (OpenMetadata, full lakehouse) are under `--profile full`.

Phase 2 added about 3.9 GB. Docker Desktop's default VM (≈ 7.5 GiB) is now tight during a cold start, when
every JVM boots at once. Give Docker 10–12 GB on a 16 GB laptop. Phase 2 also raised Grafana to 512 MB (its
dashboard search index thrashed at 256 MB) and Tempo to 512 MB, and dropped Tempo's `local-blocks` processor.

## Consequences

Each phase measures and updates this table. A phase that breaks the budget must move something behind a profile.
