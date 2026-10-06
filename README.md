# Raadiso

Raadiso ([raadiso.com](https://raadiso.com); from _raadi_, "search" in Somali) is an open-source classifieds
marketplace by Horumar Group, in the spirit of Finn.no. It starts in Somaliland and grows into one marketplace
for many countries, like Locanto ([ADR-0032](docs/adr/0032-multi-country-marketplace.md),
[ADR-0033](docs/adr/0033-horumar-group-and-somaliland-first.md)). In the code it keeps its working
name, `raadi` (packages, the `./raadi` command, the Keycloak realm). It has a web app, a mobile app, domain
microservices and four AI pillars: governance, cybersecurity, data management and IaC operations. All of it
is free of charge, open source first, and runs fully offline on a laptop, with **Docker as the only prerequisite**.

## Quickstart

```bash
git clone https://github.com/Jibsta91/raadi.com.git raadi && cd raadi
docker compose up
```

When the stack is ready, the `summary` container prints every URL and the demo logins. Open
**http://raadi.localhost**.

> Something off? `./raadi doctor` checks Docker, memory, disk, ports, name resolution and the clock, and
> says how to fix each problem (`./raadi up` runs it first).
>
> `*.localhost` resolves to your machine without editing the hosts file. HTTPS also works
> (`https://raadi.localhost`) with a dev CA generated inside a container; trusting it is optional
> (`./raadi ca-cert`). The first run builds images and takes a few minutes; later starts take about a minute.

## Demo users

All demo users share the password **`raadi-demo-pass`** (development only; production has no seed users).

| User                            | Role                           |
| ------------------------------- | ------------------------------ |
| `kari.nordmann@raadi.localhost` | buyer/seller (Norwegian)       |
| `ola.nordmann@raadi.localhost`  | buyer/seller (Norwegian)       |
| `amina.hassan@raadi.localhost`  | buyer/seller (English)         |
| `moderator@raadi.localhost`     | moderator (Grafana viewer)     |
| `admin@raadi.localhost`         | platform admin (Grafana admin) |

**Sign up.** "Sign up" in the header opens the Raadiso-branded registration page. The confirmation e-mail lands in
Mailpit (http://mail.raadi.localhost); after confirming you choose a password, accept the terms and see a
welcome page.

**BankID (test).** "Verify with BankID" on the account page goes to a mock BankID provider (the `bankid-mock`
realm in Keycloak). Sign in there as one of the synthetic test people `01897000011`, `02897000022`,
`03897000033`, `04897000044` or `05897000055`, with the same password. Each test person can verify one Raadiso
account at a time.

Generated infrastructure credentials are never committed. Read them with `./raadi secret <name>`, for example
`keycloak_admin_password`, `grafana_admin_password` or `openbao_root_token`.

## Architecture

```mermaid
flowchart LR
  U((Browser / app)) -->|80/443| T[Traefik<br/>TLS · rate limits · headers · forward-auth]
  T --> W[web<br/>Next.js]
  T --> B[identity-bff<br/>token handler]
  T --> LS[listings] & SE[search] & ME[media] & MS[messaging<br/>REST + WebSocket] & TR
  T -->|/img| IP[imgproxy<br/>signed URLs]
  T --> K[Keycloak<br/>OIDC · MFA · passkeys]
  T --> G[Grafana]
  W --> B & SE & LS
  B --> K
  B --> V[(Valkey<br/>sessions · pub/sub)]
  MS --> V
  KA --> NO[notifications<br/>e-mail · in-app]
  KA --> TR[trust<br/>reviews · BankID]
  T --> PA[payments<br/>Vipps · Stripe adapters]
  PA -->|ePayment API| PM[payments-mock<br/>test PSP]
  PA -->|promotion events| KA
  TR -->|OIDC| K
  NO -->|SMTP| ML[Mailpit / SMTP]
  NO -->|users API| K
  MS -->|seller lookup| LS
  B & LS & ME & MS --> P[(PostgreSQL 17<br/>PostGIS · pgvector)]
  LS & ME --> FGA[OpenFGA]
  LS --> OPA[OPA]
  ME --> AV[ClamAV] & S3[(SeaweedFS S3)]
  IP --> S3
  P -->|outbox CDC| DBZ[Debezium] --> KA[(Kafka)]
  KA --> SE & ME
  SE --> OS[(OpenSearch)]
  B & LS & ME & SE -.->|AppRole| O[OpenBao]
  B & W & T & K & LS & ME & SE -->|OTLP| C[OTel Collector]
  C --> PR[(Prometheus)] & L[(Loki)] & TE[(Tempo)]
  PR --> AM[Alertmanager]
  G --> PR & L & TE
```

The C4 context and container diagrams, the request flow and the startup graph are in
[docs/architecture/c4-container.md](docs/architecture/c4-container.md). Decisions are recorded as
[ADRs](docs/adr/README.md).

## Services and ports

Only the gateway publishes host ports (`127.0.0.1:80` and `:443` in development). Internal ports are on the
Compose network.

| Service                            | Internal port           | URL (development)                                                       |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| Web app (Next.js)                  | 3000                    | http://raadi.localhost                                                  |
| identity-bff (NestJS)              | 4000                    | http://raadi.localhost/auth/\*, /api/v1/identity/\*                     |
| listings · search · media (NestJS) | 4000 each               | /api/v1/listings · /api/v1/search · /api/v1/media                       |
| messaging (NestJS)                 | 4000                    | /api/v1/messaging/\* (REST), /api/v1/messaging/ws (WebSocket)           |
| notifications (NestJS)             | 4000                    | /api/v1/notifications/\* (in-app, preferences); e-mail via SMTP         |
| trust (NestJS)                     | 4000                    | /api/v1/trust/\* (reviews, profiles, BankID verification)               |
| payments (NestJS)                  | 4000                    | /api/v1/payments/\* (promoted listings, provider webhooks)              |
| saved · audit (NestJS)             | 4000 each               | /api/v1/saved/\* (favourites, saved searches) · audit: console only     |
| Admin console (web + admin-bff)    | 3000 · 4000             | http://admin.raadi.localhost (staff, one-time code)                     |
| payments-mock · push-mock (dev)    | 4000 each               | http://pay.raadi.localhost/pay/… · http://push.raadi.localhost/messages |
| Expo dev server (Metro)            | 8081                    | `./raadi phone` (Expo Go on the same Wi-Fi, docs/mobile.md)             |
| imgproxy (listing images)          | 8080                    | http://raadi.localhost/img/… (signed URLs only)                         |
| Keycloak                           | 8080, 9000              | http://auth.raadi.localhost (admin console: `/admin/`)                  |
| Grafana                            | 3000                    | http://grafana.raadi.localhost (SSO as `admin@raadi.localhost`)         |
| Prometheus / Alertmanager          | 9090 / 9093             | http://prometheus.raadi.localhost                                       |
| Traefik dashboard                  | — (`api@internal`)      | http://traefik.raadi.localhost/dashboard/                               |
| OpenBao                            | 8200                    | http://bao.raadi.localhost/ui/                                          |
| Mailpit (all e-mail in dev)        | 1025 / 8025             | http://mail.raadi.localhost                                             |
| PostgreSQL · Valkey                | 5432 · 6379             | internal only                                                           |
| Kafka · Kafka Connect · Apicurio   | 9092 · 8083 · 8080      | internal only                                                           |
| OpenSearch · SeaweedFS · ClamAV    | 9200 · 8333 · 3310      | internal only                                                           |
| OpenFGA · OPA                      | 8080 · 8181             | internal only                                                           |
| OTel Collector · Loki · Tempo      | 4317/4318 · 3100 · 3200 | internal only (via Grafana)                                             |

The full table, including the services that later phases add, is in
[docs/architecture/c4-container.md](docs/architecture/c4-container.md#services-and-ports).

## Everyday commands

Each command is available as `./raadi <command>` or `make <command>`. Everything runs in containers.

| Command                                      | What it does                                                          |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `./raadi doctor`                             | check this machine first: Docker, memory, disk, ports, DNS, clock     |
| `./raadi up` / `down`                        | start (and wait until healthy) / stop                                 |
| `./raadi status`                             | health, memory against each limit and CPU of every service            |
| `./raadi dev`                                | hot-reload mode: source bind-mounted, `node_modules` in named volumes |
| `./raadi lint` · `typecheck` · `test`        | quality checks in the toolbox                                         |
| `./raadi test-integration`                   | Testcontainers tests (PostgreSQL, Valkey, OpenSearch)                 |
| `./raadi smoke` · `e2e`                      | smoke test and Playwright tests against the running stack             |
| `./raadi security` · `iac-scan` · `licenses` | Trivy, Gitleaks, OSV-Scanner · Checkov · license gate                 |
| `./raadi toolbox`                            | shell with pnpm, uv, tofu, ansible, checkov, trivy, playwright…       |
| `./raadi secret <name>` · `ca-cert`          | read a generated secret · export the dev CA                           |

The toolbox can also be called directly: `docker compose run --rm toolbox <command>`. VS Code users can
optionally open the repository in the [Dev Container](.devcontainer/devcontainer.json).
[docs/development.md](docs/development.md) covers the development workflow.

## Switching the LLM provider

_Available from Phase 4._ AI services never call a model vendor directly. They call **LiteLLM**, an
OpenAI-compatible proxy, which routes to local **Ollama** models by default, so the platform runs offline. To
use another provider (any OpenAI-compatible API, Azure OpenAI, Anthropic, Mistral, a vLLM server and so on),
change the model routes in `deploy/litellm/config.yaml` and put the provider's API key in OpenBao. The services'
code doesn't change. AI Governance logs model, version and prompt version for every decision, so provider
switches stay auditable.

## Deploying

The same images and Compose files run on any Linux VM with Docker. Provisioning (OpenTofu), the Deploy
workflow, Let's Encrypt, backups and the "zero to live in 15 minutes" guide arrive in Phase 5 as
[docs/deploy.md](docs/deploy.md).

## Project status

Phases 1 (foundation), 2 (listings, search, media, web) and 3 (messaging, notifications, mobile) are
complete. You can browse and search about 500 demo listings (full text, facets, geo radius), and sign in to
create, edit, sell and delete listings with virus-scanned images. Buyers and sellers message each other with
live delivery over WebSockets, get e-mail, in-app and push notifications, review each other after a sale,
verify their identity with BankID (mocked in development), promote listings with payments (a
Vipps-compatible test provider in development), keep favourites and saved searches, and report listings or
block people. Staff work in an admin console with one-time codes and an append-only audit log. The Raadiso
app (Expo) runs on iPhone and Android. Phase 4 (the AI pillars) is next; see the
[roadmap](docs/roadmap.md) for later phases.

## Documentation

- [Architecture (C4)](docs/architecture/c4-container.md) · [ADRs](docs/adr/README.md) ·
  [Threat model](docs/threat-model.md) · [Runbooks](docs/runbooks/README.md) ·
  [Development](docs/development.md) · [Roadmap](docs/roadmap.md) · [Releases](docs/releasing.md) ·
  [Changelog](CHANGELOG.md) · [AI team](docs/ai-team.md)

## License

[Apache-2.0](LICENSE). All third-party components are free of charge and mostly under OSI-approved licenses;
[ADR-0009](docs/adr/0009-open-source-licensing-policy.md) sets the rules for the exceptions and where they are listed.
