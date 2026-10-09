# 0054 — One staff gate in front of every staff tool in production

- Status: Accepted
- Date: 2026-10-09
- Supersedes [ADR-0052](0052-dockhand-on-its-own-host.md) (its Dockhand-only proxy). Builds on
  [ADR-0028](0028-admin-console-staff-roles-and-audit.md) and
  [ADR-0051](0051-production-on-one-server.md).

## Context

The admin console's Tools page lists the stack's web interfaces. In production most of them weren't
served, so staff saw "Not served", or a link that ended in a 404 (the push mock, which production
doesn't run). The owner wants them reachable like the admin console and Grafana. Dockhand already had
its own oauth2-proxy in front (ADR-0052). Several of these tools have weak or no sign-in of their own
(Prometheus and Traefik's dashboard have none), and Keycloak's admin console holds the realm.

## Decision

- **One gate, `staff-gate`** (oauth2-proxy 7.12, MIT), in Traefik's forward-auth mode. Traefik asks it
  about every request to a staff tool. It lets a request through (202) only for a Keycloak session
  with the `platform-admin` role, signed in with a one-time code: the `staff-gate` client uses the
  admin console's browser flow. Otherwise the browser goes to the sign-in. Each tool's host has its own
  callback and cookie (`__Host-raadi-staff`, 12 hours, checked against Keycloak every 5 minutes);
  Keycloak's single sign-on makes the next tool a redirect without a form.
- **Behind the gate, with their own logins on top** (`STAFF_TOOLS_ROUTED=true`, production only):
  GlitchTip (`errors.`), Prometheus (`prometheus.`), Traefik's dashboard (`traefik.`), Keycloak's admin
  console (`auth.…/admin/`) and, when `DOCKHAND_URL` is set, Dockhand (`dockhand.`).
- **Never served: OpenBao.** It holds every secret; a stolen staff session must not reach it. It stays
  behind an SSH tunnel (`docs/deploy.md`), the owner's choice.
- **The Tools page follows:** gated tools show as served; the development stand-ins (Mailpit, push
  mock) aren't listed in production; secret commands read `./raadi deploy secret …`.
- The Dockhand-only proxy, its `dockhand` profile and the `dockhand` Keycloak client go; keycloak-init
  removes that client.

## Alternatives considered

- **A proxy per tool** (as ADR-0052 did for Dockhand): five containers, five clients and five sets of
  secrets for the same check.
- **Each tool's own login only:** Prometheus and Traefik have none, and the others would put their
  passwords on the open internet.
- **The SSH tunnel for everything:** safest, but the owner found it impractical.

## Consequences

- Only platform admins reach these tools. Operators and moderators keep Grafana (its own role mapping)
  and the admin console; opening a tool to more roles is a change to `OAUTH2_PROXY_ALLOWED_ROLES`.
- A new staff tool is a router with the `staff-gate` middleware, its host on the gate's callback route,
  and its callback in the `staff-gate` client.
