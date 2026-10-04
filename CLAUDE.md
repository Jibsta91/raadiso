# Raadi: working notes for AI coding sessions

Raadi is a Finn.no-style classifieds marketplace (web, mobile, domain microservices, four AI pillars). Users
see it as **Raadiso** (raadiso.com): the brand in UI text, e-mails, login pages and the app name. Code keeps the
working name `raadi` (packages, `./raadi`, realm, databases, images). In Somali text, "raadi" is also the verb
"search": leave those strings alone. It is built in six phases; [docs/roadmap.md](docs/roadmap.md) holds the
scope and status of each. Read that first, then [docs/development.md](docs/development.md) (layout, service
checklist, conventions) and [docs/adr/README.md](docs/adr/README.md) (decisions already made; don't
re-litigate them without a new ADR).

## Non-negotiables

- **One command:** `docker compose up` on a clean machine brings everything up healthy. Docker is the only
  host prerequisite; every tool runs in the `toolbox` service. The dev `.env` is committed; `.env.example`
  documents every variable.
- **Compose:** healthchecks on every service; `depends_on` with conditions; one-shot init containers
  (`deploy/compose/init.yaml`) do migrations, the Keycloak realm, buckets, topics, seeds and models
  idempotently. Exact version pins (never `:latest`; digests for base images), memory limits that fit a
  16 GB laptop ([ADR-0011](docs/adr/0011-resource-budget.md)), heavy extras behind compose profiles. New
  services must appear in the `summary` output.
- **Licensing:** 100% OSI-licensed and runs offline ([ADR-0009](docs/adr/0009-open-source-licensing-policy.md)).
  No BSL/SSPL/Elastic-licensed components.
- **Services:** 12-factor; OTel traces, metrics and logs everywhere; transactional outbox with CloudEvents; one
  database per service; retries, circuit breakers and rate limits; non-root distroless images; multi-arch.
- **Security:** OIDC everywhere (Keycloak), zero trust between services, secrets only from OpenBao, TLS at the
  edge, OWASP ASVS L2, GDPR (no PII in logs or events).
- **Git:** `main` is protected (PR only, both CI jobs green, signed commits, squash merge). Work on a branch,
  push it, open a PR and merge it through the GitHub API once CI passes. Never push to `main` directly.
- **Stack is settled:** Keycloak + OpenBao (Authentik/Bitwarden were considered and rejected). No Kubernetes.
- **Phase gate:** a phase is done only when a cold `docker compose up` is green and smoke, e2e, lint,
  typecheck, unit, integration, licenses, security and iac-scan all pass. No TODO placeholders. Write an ADR
  for each decision.
- **Production (Phase 5):** `compose.prod.yaml`, images on GHCR, Let's Encrypt, OpenTofu, cloud-init,
  Ansible, restic. On the server, the stack runs as the non-root `prod` user in
  `DEPLOY_DIR=/home/prod/raadi`, the secrets directory is `chmod 700`, and the admin user is used only by
  Ansible.

## Commands

`./raadi <cmd>` (or `make <cmd>`): `up`, `down`, `dev`, `lint`, `typecheck`, `test`, `test-integration`,
`smoke`, `e2e`, `security`, `iac-scan`, `licenses`, `toolbox`, `secret <name>`, `ca-cert`, `restart <svc>`.

Verify the current state before starting new work:

```bash
./raadi up && ./raadi smoke && ./raadi e2e && ./raadi lint
```

A full reset (wipes data): `docker compose down -v --remove-orphans`.

## Environment gotchas (Docker Desktop for Linux; give the VM 12+ GB from Phase 2)

- Bind mounts work only from paths under `/home`. Pipe scripts into containers via stdin instead.
- Host file events don't reach containers: dev hot reload polls, and Traefik needs
  `./raadi restart traefik` after editing `deploy/traefik/**`.
- `docker compose up --wait` fails on any exited container that nothing depends on. That's why `summary`
  stays running as a readiness sentinel. Make new one-shot jobs dependencies of something long-running.
- `*.localhost` resolves to `::1` first, so the gateway publishes on both `BIND_ADDRESS` and `BIND_ADDRESS_V6`.
- Prettier re-quotes YAML. Check that `user: '0:0'`-style values survive a format run.
- Turbo 2 strict env mode hides container env vars unless they're listed in `passThroughEnv`.
- Init-container CLIs (bao, dbmate) thrash below ~256M memory.
- Docker remounts a `tmpfs` as root-owned 0755 when a container restarts. Always give tmpfs entries an
  explicit `:mode=1777`, and never `cp` over read-only files in entrypoints (`cap_drop: ALL`, no DAC override).
- Arguments to `./raadi e2e` replace the container command: run one spec with
  `./raadi e2e e2e specs/<file>.spec.ts`.
- Grafana has basic auth disabled. For API checks, log in with `POST /login` (admin secret) and use the cookie.
- OpenSearch's search user may only touch `raadi-listings*`, so index/alias calls must name that pattern.
- All Playwright workers reach Traefik from one IP and share its per-client rate limit. A 429 on a page or
  JS chunk means the page never hydrates (forms submit natively, `router.push`/`onChange` do nothing). Keep
  links rendered on every page (header, footer) at `prefetch={false}`: each prefetch is a full dynamic render.
- Switching branches with the stack running leaves the other branch's Keycloak realm and init state in the
  volumes, and Keycloak can crash-loop. Do a cold start after switching between branches that change
  Keycloak or init (`docker compose --profile tools --profile test down -v --remove-orphans`, then `up`).
- After the laptop sleeps, Docker Desktop can wedge (Kafka stops answering, containers cannot be killed).
  Run `systemctl --user restart docker-desktop`, then do a cold start. A wedged VM also made Keycloak drop
  `raadi-bff` client sessions after a few minutes, so token refreshes failed with "Session doesn't have
  required client" and users were signed out. That stopped after the restart (refreshes then worked after a
  330 s gap). `ENOTFOUND registry.npmjs.org`
  during a build is a dropped network: retry.
- A locked 1Password SSH agent ("communication with agent failed", "failed to fill whole buffer") blocks
  signed commits, tags and pushes. Ask the user to unlock it; never disable signing.
- The toolbox mounts only this checkout. In a worktree, bind-mount the worktree's files explicitly and run
  `./raadi lint` on them before pushing.
- A service that consumes Kafka needs `kafka-init: service_completed_successfully` in `depends_on`, or a
  cold start fails with "Group authorization failed".
- Right after a cold start, demo users' first login lands on `/<locale>/welcome`. Tests must accept both.
- A failed full-stack CI job uploads `compose-logs.txt` as an artifact; download it through the API.
- Event schemas are JSON Schema draft-07 (Apicurio cannot check 2020-12). Adding an optional field is
  BACKWARD compatible; removing one is not, and a dev registry then needs `down -v`.
- Events never carry names (listings' tests enforce it). Services fetch public names from listings'
  internal contact API with the user's token.
- `./raadi` runs several turbo tasks in one call (`lint typecheck test`), but `licenses`, `security` and
  `iac-scan` must each be a separate call.
- `./raadi generate` after changing an OpenAPI spec, and commit the generated client.

## Demo logins

All seeded users (`kari.nordmann@`, `ola.nordmann@`, `amina.hassan@`, `moderator@`, `support@`, `operator@`,
`admin@` at `raadi.localhost`) use the password `raadi-demo-pass`. Read infrastructure secrets with `./raadi secret <name>`.
