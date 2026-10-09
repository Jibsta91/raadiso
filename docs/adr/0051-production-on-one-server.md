# 0051 — Production on one server: compose.prod.yaml and ./raadi deploy

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0011](0011-resource-budget.md) (budget), [ADR-0023](0023-domain-dns-and-tls.md)
  (DNS and TLS) and [ADR-0033](0033-horumar-group-and-somaliland-first.md) (Somaliland first).

## Context

Phase 5 puts Raadiso on the internet at raadiso.com for Somaliland. The owner rented one OVHcloud VPS
(8 vCPU, 22 GiB, Ubuntu 26.04, Docker from Docker's apt repository). The stack already runs from one
`docker compose up`; production must not become a second way of running it. The first slice has to
come up healthy without things the owner hasn't chosen yet: a mail provider, a payment provider and
an identity provider for Somaliland.

## Decision

- **The same compose files, plus one overlay.** `compose.prod.yaml` switches off the development
  stand-ins (Mailpit, payments-mock and push-mock move to a `dev` profile), mounts only the common and
  production Traefik routes, redirects every plain-HTTP request to HTTPS, and gives Postgres,
  OpenSearch, Kafka and Keycloak more memory than the 16 GB laptop budget allows.
- **Settings in three layers.** The server's `.env` is `.env.example`, then the committed
  `deploy/prod/prod.env`, then the owner's uncommitted `deploy/prod/local.env` (server address, SMTP);
  the last value of a key wins. `prod.env` holds nothing secret. It sets
  `COMPOSE_FILE=compose.yaml:compose.prod.yaml`, so plain `docker compose` and `./raadi` on the server
  use the overlay.
- **What is off in production:** demo users, listings and one-time codes (`SEED_DEMO_DATA=false`);
  routes to Keycloak's admin console, the admin console host, the dev tools and Grafana (reached
  through an SSH tunnel instead); the BankID mock; Grafana's own mail.
- **Payments provider `none`.** No provider serves Somaliland yet. With `PAYMENTS_PROVIDER=none` the
  payments service starts without provider secrets, offers no products and refuses new orders, and the
  promote page says promotions are unavailable.
- **SMTP is optional at first.** Keycloak and notifications take `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE` and `SMTP_USER`; the password is the supplied secret `smtp_password`, synced to OpenBao
  only once it exists. Until it is set, sign-up and password-reset mail is not delivered.
- **One server, run by a non-root user.** `deploy/prod/setup-server.sh` (run once by the admin user
  with sudo, through `./raadi deploy setup`) creates the `prod` user in the `docker` group and
  `/home/prod/raadi` with a `secrets` directory at 0700. It also opens only 22, 80 and 443 in ufw,
  keeps unattended security upgrades on, bounds the journal and Docker's logs, checks
  `vm.max_map_count` for OpenSearch and adds 4 GB of swap. Generated secrets stay in the stack's
  `secrets` volume (0700, written by secrets-init) and in OpenBao.
- **`./raadi deploy` builds on the server.** It refuses uncommitted changes, rsyncs the commit (no
  `.git`, nothing Git ignores) to `/home/prod/raadi` as `prod`, writes `.env` and `.deployed` (the
  commit), and runs `docker compose up -d --build --wait`. The init containers make every run
  idempotent. `./raadi deploy <command>` runs any other `./raadi` command on the server.
- **TLS by DNS-01.** `./raadi deploy cert` runs the existing `./raadi cert --install` on the server:
  a Let's Encrypt wildcard for raadiso.com through the GoDaddy API, so nothing needs to be reachable
  before DNS points at the server. The owner stores `godaddy_pat` on the server with
  `./raadi deploy secret-set godaddy_pat`. DNS is switched last, with `./raadi dns <server-ip>`.

## Alternatives considered

- **Images built once and pulled from GHCR** (the Phase 5 target in the roadmap). This needs a
  registry login on the server and either GitHub Actions, which are off, or slow multi-arch builds on
  the laptop. Building on the server's 8 vCPUs is faster for now; GHCR, signed images, OpenTofu and
  Ansible follow in a later slice.
- **Docker Swarm with auto-scaling.** Not for one server. It needs its own ADR: a stack file instead
  of compose features, a lock for the payments reconcile job, and Kafka partitions to scale on.
- **Let's Encrypt by HTTP-01 in Traefik.** It needs DNS pointed at the server before the first
  certificate, and a separate path from the one phone and tunnel mode already use.

## Consequences

- No one can sign up until SMTP is configured; no one can buy a promotion until a provider is chosen.
- A deploy rebuilds changed images on the server and briefly restarts changed services; there is no
  zero-downtime rollout yet.
- Backups (restic) of Postgres, SeaweedFS, OpenBao and the secrets volume, monitoring from outside,
  GHCR images and infrastructure as code are still to come in Phase 5.
- Dockhand, which the owner runs on the same server, is left alone: it listens on 127.0.0.1:3000, and
  the stack publishes only 80 and 443.
