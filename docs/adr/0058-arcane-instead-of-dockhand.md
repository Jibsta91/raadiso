# 0058 — Arcane instead of Dockhand as the owner's Docker UI

- Status: Accepted
- Date: 2026-10-10
- Builds on [ADR-0054](0054-staff-gate-for-staff-tools.md) (the staff gate) and replaces its Dockhand
  route; the Dockhand notes in [ADR-0051](0051-production-on-one-server.md) and
  [ADR-0052](0052-dockhand-on-its-own-host.md) no longer apply.

## Context

The owner ran Dockhand, a web UI for Docker, on the production server, served on `dockhand.` behind
the staff gate when `DOCKHAND_URL` was set. The owner wants Arcane instead.

## Decision

- **Arcane** (getarcaneapp/arcane, BSD-3-Clause, so allowed by
  [ADR-0009](0009-open-source-licensing-policy.md)) replaces Dockhand. Its image is pinned by version and
  digest in `deploy/arcane/compose.yaml`.
- **Started on its own, not part of the stack**, as Dockhand was: its own compose project (`arcane`)
  on the stack's network (`raadi_default`), so `docker compose up --remove-orphans` in the stack never
  touches it and a deploy does not restart it. It publishes no port.
- **Served on `arcane.$RAADI_DOMAIN` behind the staff gate** when `ARCANE_URL` is set: platform admins
  with a one-time code, then Arcane's own login. The staff gate's Keycloak client gets the new callback
  in place of Dockhand's; `DOCKHAND_URL` and the `dockhand.` route are removed.
- **Its secret** (Arcane's encryption key) lives in `deploy/arcane/arcane.env` on the server, mode
  0600 and ignored by Git and by the deploy's rsync. Arcane is the owner's tool outside the stack, so
  its key is not in OpenBao, like Dockhand's own settings before it.

## Alternatives considered

- **Keep Dockhand:** the owner's choice is Arcane.
- **Arcane inside `compose.prod.yaml`:** every deploy would restart the tool used to watch the deploy,
  and the Docker socket would become part of the stack's own definition.

## Consequences

- Arcane holds the Docker socket, as Dockhand did: getting past the staff gate and Arcane's login
  means control of every container. The gate stays the outer lock.
- The wildcard certificate and DNS record already cover `arcane.`; nothing changes there.
- An operator who set `DOCKHAND_URL` must switch to `ARCANE_URL`; the old variable is ignored.
- Hardened on 2026-10-11 (docs/deploy.md): no analytics heartbeat, `APP_URL` and trusted proxies set, a
  fixed `JWT_SECRET`, and in-app auto-update, auto-heal and image auto-patch off, so Arcane never changes
  the stack's pinned images on its own.
