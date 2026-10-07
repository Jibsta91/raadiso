# Development guide

Prerequisites: **Docker** (Desktop, or Engine + Compose v2) and **Git**. Every other tool runs in containers.

Before the first start, `./raadi doctor` checks Docker, memory, disk, ports, name resolution and the clock;
`./raadi status` shows each running service's health, memory and CPU.

## Run modes

| Mode       | Command                                                                 | Use it for                                           |
| ---------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Normal     | `docker compose up` (or `./raadi up`)                                   | Running the platform exactly as production images do |
| Hot reload | `./raadi dev` (`docker compose -f compose.yaml -f compose.dev.yaml up`) | Editing web or service code with instant reload      |
| Toolbox    | `./raadi toolbox` (`docker compose run --rm toolbox bash`)              | pnpm, uv, tofu, ansible, checkov, trivy, playwright… |

In hot-reload mode the repository is bind-mounted at `/workspace`. `node_modules` and the pnpm store live in
named volumes (`nm-*`, `pnpm-store`) shared with the toolbox, so nothing platform-specific is written to your
machine. File watching uses polling, so edits made on macOS/Windows/Docker Desktop are picked up (web ≈ 3 s,
services ≈ 10 s). One `dev-packages` container rebuilds the shared packages (`service-kit`, `catalog`,
`events`); every service restarts when one of them changes.

After editing gateway configuration (`deploy/traefik/**`), run `./raadi restart traefik`. File-change events
don't always cross Docker Desktop's file sharing.

## Repository layout

```
apps/web                 Next.js 16 (App Router, RSC), next-intl (nb/en/so), Tailwind 4, shadcn/ui-style components
apps/mobile              Expo app (Phase 3, docs/mobile.md)
services/identity-bff    NestJS: OIDC login, encrypted sessions, token handler, /api/v1/identity (also runs as
                         admin-bff, the admin console's own session, ADR-0028)
services/listings        NestJS: listings CRUD, OPA marketplace rules, OpenFGA ownership, outbox events
services/search          NestJS: OpenSearch indexer (Kafka consumer) and search/suggest API
services/media           NestJS: image uploads (ClamAV, imgproxy re-encode), attachment sync, orphan GC
services/messaging       NestJS: buyer-seller conversations, WebSocket push (Valkey pub/sub fan-out)
services/notifications   NestJS: e-mail queue (SMTP, Keycloak lookups) and in-app notifications from events
services/trust           NestJS: reviews after a sale (event-fed eligibility) and BankID verification (OIDC)
services/payments        NestJS: promoted listings; Vipps/Stripe adapters, idempotent orders, webhooks, reconciliation
services/payments-mock   NestJS: Vipps ePayment-compatible test PSP with a hosted approve page (development only)
services/saved          NestJS: favourites and saved searches; alerts (price drop, sold, new matches) as events
services/audit           NestJS: append-only audit log of staff actions (outbox events from every service)
services/push-mock      Node: Expo push API-compatible stand-in with an inbox for tests (development only)
services/*               further domain services (Phase 3)
ai/*                     Python AI pillars (Phase 4)
packages/service-kit     telemetry, logging, OpenBao, JWT guard, errors, resilience, health, shutdown,
                         outbox, Kafka consumer (retries, DLQ), OpenFGA/OPA clients, imgproxy signing
packages/catalog         taxonomy, attribute schemas, places (geo) and the deterministic demo dataset
packages/events          CloudEvents contracts (zod), JSON Schemas for Apicurio, topic names
packages/api-client      typed client generated from services' OpenAPI contracts
packages/ui              design-system components
packages/config          shared tsconfig and ESLint presets
deploy/compose/*.yaml    compose slices included by compose.yaml (one per concern)
deploy/docker/*          build recipes for our own code: node-service (every NestJS service), web, node-dev
deploy/init              raadi-init image: bootstrap scripts + secrets/DB manifest
deploy/toolbox           toolbox image (every dev/ops CLI, pinned)
deploy/<component>/      everything for one third-party component: config, plus a Dockerfile only
                         when we wrap the upstream image (traefik, keycloak, openbao, postgres, …)
deploy/observability/*   the same, for the observability stack (otel-collector, prometheus, loki, …)
infra/{tofu,ansible,cloud-init}  (Phase 5)
tests/{smoke,e2e,licenses}
docs/                    architecture, ADRs, threat model, runbooks
```

Rule of thumb: code lives in `apps/`, `services/` and `packages/`; anything that describes how a container is
built or configured lives under `deploy/`, grouped by component rather than by file type.

## Tests

| Kind                                    | Where                                              | Command                    |
| --------------------------------------- | -------------------------------------------------- | -------------------------- |
| Unit + contract                         | `**/test/unit`, `packages/*/test`, `apps/web/test` | `./raadi test`             |
| Integration (Testcontainers)            | `services/*/test/integration`                      | `./raadi test-integration` |
| Authorization policies (Rego)           | `deploy/opa/policies/**/*_test.rego`               | `./raadi test`             |
| Smoke (full stack, through the gateway) | `tests/smoke/smoke.sh`                             | `./raadi smoke`            |
| End-to-end (Playwright, Chromium)       | `tests/e2e/specs`                                  | `./raadi e2e`              |

Contract tests validate controller output against the service's `openapi.yaml`, the same document that
generates `@raadi/api-client`. `./raadi generate` rebuilds that client and the event JSON Schemas in
`packages/events/schemas` (from the zod contracts); run it after changing either.

## CI on this laptop (self-hosted runner)

Pull requests are checked by `.github/workflows/ci.yaml` on a GitHub Actions runner that runs on the
development laptop ([ADR-0036](adr/0036-self-hosted-ci-runner.md)). The jobs run the same `./raadi`
commands as above, under their own compose project and image names (`raadi-ci`), so they never touch your
running stack.

| Job                       | Runs on                                                                | Steps                                                                 |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Lint, types, tests, scans | every pull request and push to `main`                                  | lint, typecheck, test, test-integration, licenses, security, iac-scan |
| Full stack                | the `full-stack` label on a pull request, a push to `main`, or by hand | `compose up`, smoke, e2e on ports 18080/18443, then `down -v`         |

The full stack job needs about 7 GB more in Docker next to your own stack; stop yours (`./raadi down`) on a
small machine. Pull requests from forks never run: the repository is public, and the runner has the
Docker socket.

Setting it up once:

1. In the repository settings, turn GitHub Actions on (Settings → Actions → General → Allow actions), and
   under "Fork pull request workflows from outside collaborators" choose **Require approval for all
   external contributors**.
2. `./raadi runner register` and paste a registration token (Settings → Actions → Runners → New
   self-hosted runner, or `gh api -X POST repos/Jibsta91/raadiso/actions/runners/registration-token --jq
.token`; it is valid for one hour). The runner keeps its own credentials in the `ci-runner-config`
   volume; no GitHub token is stored.
3. `./raadi runner start`. It shows up under Settings → Actions → Runners as `raadi-…`, idle.
4. Optional: make "Lint, types, tests, scans" a required check for `main` (Settings → Branches).

`./raadi runner stop` stops it; jobs then wait in GitHub's queue. Jobs run only while the laptop is on.
The runner's version is pinned and doesn't update itself: GitHub stops accepting very old runners, so bump
`deploy/ci-runner/Dockerfile` (Renovate does) and register again if it is ever refused.

## Dependency updates (Renovate)

Renovate ([ADR-0037](adr/0037-renovate-dependency-updates.md)) opens pull requests for new versions of
everything pinned in the repository, configured in `renovate.json`. It runs every Monday morning on the
self-hosted runner, or now with `./raadi renovate` (`./raadi renovate --dry-run=full` only reports).
Majors wait until you tick them on the "Dependency Dashboard" issue. Image updates get the `full-stack`
label, so CI runs the whole stack on them. The Expo SDK is excluded: upgrade it with `expo upgrade`.

To pin a version Renovate can't find on its own, put a comment above it:
`# renovate: datasource=github-releases depName=owner/repo extractVersion=^v(?<version>.+)$`.

Setting it up once: create a fine-grained token at github.com → Settings → Developer settings →
Fine-grained tokens, for this repository only, with read and write access to Contents, Pull requests,
Issues and Workflows. Store it with `./raadi secret-set renovate_token` (for `./raadi renovate`) and as the
repository secret `RENOVATE_TOKEN` (Settings → Secrets and variables → Actions, for the weekly run).

## Browser automation for AI coding sessions (MCP)

`.mcp.json` registers the [Playwright MCP server](https://github.com/microsoft/playwright-mcp) (Apache-2.0)
for Claude Code and other MCP clients, so an assistant can open the running app, click through it and take
screenshots while it works. It runs headless in Docker (no host install) and joins Traefik's network
namespace, like the e2e container, so `http://raadi.localhost` resolves to the gateway. Start the stack
first (`./raadi up`), then approve the server when the client asks. The image is pinned by version and
digest; Renovate updates it.

## Adding a NestJS service (checklist)

1. `services/<name>/` with `package.json` (`build`, `dev`, `test`, `lint`, `typecheck` scripts), `openapi.yaml`,
   `src/telemetry.ts` (calls `startTelemetry`), `src/main.ts` modelled on identity-bff.
2. Use `@raadi/service-kit`: `JwtAuthGuard` (global), `ProblemDetailsFilter`, `RouteSpanInterceptor`,
   `ZodValidationPipe`, `HealthRegistry` + `installGracefulShutdown`, `OpenBaoClient` for secrets.
3. Register it in `deploy/init/manifest.json` (UID, database, extensions, OpenBao secrets). `secrets-init`,
   `openbao-bootstrap` and `db-init` pick it up automatically. Put SQL migrations in `migrations/` (dbmate format).
4. Add the compose service in `deploy/compose/apps.yaml` (build with `deploy/docker/node-service/Dockerfile`,
   `SERVICE=<name>`) and a router in `deploy/traefik/dynamic/common/routes.yml` with the `forward-auth` middleware.
5. Add `nm-<name>` volumes to `deploy/compose/tools.yaml` and `compose.dev.yaml`, and a hot-reload override in
   `compose.dev.yaml` (`pnpm --filter <name> dev`, depending on `dev-packages`).
6. If it publishes events: set `"outbox": true` in the manifest (connect-init registers a Debezium connector),
   add the contracts to `@raadi/events` and the topic and ACLs to `deploy/kafka/init.sh`.
7. Make `summary` depend on it, extend the smoke test, e2e specs and Grafana dashboards. Write an ADR if a
   decision was involved.

## Conventions

- Logs: one JSON object per line (`level`, `time`, `service`, `msg`, `trace_id`). Never log tokens or personal data.
- Errors: RFC 9457 `application/problem+json`.
- Events: CloudEvents 1.0 written to the service's `outbox` table in the same transaction as the state change.
- Config: environment variables (validated with zod at startup). Secrets come only from OpenBao.
- Versions: exact pins everywhere. Renovate proposes upgrades ([ADR-0010](adr/0010-pinned-versions.md)).
- Staff endpoints: `/admin/v1/<service>/…` with `@Staff(roles, { stepUp })` (console tokens only, never
  routed by the gateway); every change writes `audit()` in its transaction with a reason and `details`. The
  console calls them from `apps/web/src/lib/admin/api.ts` and its server actions
  ([ADR-0030](adr/0030-staff-apis-and-console-workspaces.md)).
