# 0052 — Dockhand on dockhand.raadiso.com, behind its own login

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0051](0051-production-on-one-server.md) (production on one server).

## Context

The owner runs Dockhand, a web UI for Docker, on the production server next to the stack. It was
reached only through an SSH tunnel to 127.0.0.1:3000. The owner wants it on a web address instead.
Dockhand holds the Docker socket, so whoever gets into it controls every container, and with that the
server.

## Decision

- **A route of its own, off by default.** `deploy/traefik/dynamic/prod/dockhand.yml` routes
  `dockhand.$RAADI_DOMAIN` (HTTPS only, the wildcard certificate, security headers and the default
  rate limit) to `DOCKHAND_URL`. Without `DOCKHAND_URL` in the server's `deploy/prod/local.env` there
  is no route, so the repository serves no Dockhand unless an operator opts in.
- **Dockhand joins the stack's network** (`raadi_default`, declared external in Dockhand's own
  compose file on the server), so Traefik reaches it by name. It still publishes only 127.0.0.1:3000.
- **Its own login is the lock**, the owner's choice. `DOCKHAND_URL` is set only after Dockhand's
  authentication is switched on with a strong password, and a request without a session must be
  refused before the address goes into DNS.

## Alternatives considered

- **A Keycloak staff sign-in in front** (oauth2-proxy, platform-admin and a one-time code): the
  stronger option, recommended to the owner and declined for now. It remains the upgrade path.
- **An IP allow-list** for the owner's home address: breaks whenever that address changes or the owner
  travels.
- **The SSH tunnel only:** the safest; the owner found it impractical.

## Consequences

- The server's safety rests on Dockhand's login and its updates. Dockhand runs from a mutable
  `:latest` tag outside this repository; keep it updated and its password strong and unique.
- Keycloak's staff sign-in in front of Dockhand should come before more people get staff access.
