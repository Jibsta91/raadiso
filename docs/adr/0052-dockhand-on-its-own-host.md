# 0052 — Dockhand on dockhand.raadiso.com, behind the staff sign-in

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0051](0051-production-on-one-server.md) (production on one server) and
  [ADR-0028](0028-admin-console-staff-roles-and-audit.md) (staff roles and one-time codes).

## Context

The owner runs Dockhand, a web UI for Docker, on the production server next to the stack. It was
reached only through an SSH tunnel to 127.0.0.1:3000. The owner wants it on a web address instead.
Dockhand holds the Docker socket, so whoever gets into it controls every container, and with that the
server. Out of the box its own login is off.

## Decision

- **Staff sign-in in front.** `dockhand-proxy` (oauth2-proxy 7.12, MIT) runs in `compose.prod.yaml`
  under the `dockhand` profile and passes a request on to Dockhand only for a Keycloak session with
  the realm role `platform-admin`. The Keycloak client `dockhand` uses the admin console's browser
  flow (`raadi-admin-browser`), so a one-time code is always required, and staff without an
  authenticator set one up at their first sign-in. The session cookie (`__Host-dockhand`) lasts
  12 hours and is checked against Keycloak every 5 minutes, so a removed role or a disabled account
  stops access within minutes.
- **Secrets the usual way.** secrets-init generates `dockhand_oidc_client_secret` and
  `dockhand_cookie_secret` and renders the proxy's config file into its own read-only directory.
  oauth2-proxy needs a cookie key of 16, 24 or 32 bytes, so the manifest gains a `cookie` list,
  rendered as the first 32 characters of the generated secret.
- **A route of its own, off by default.** `deploy/traefik/dynamic/prod/dockhand.yml` routes
  `dockhand.$RAADI_DOMAIN` (HTTPS only, security headers, the default rate limit) to the proxy only
  when `DOCKHAND_URL` is set in the server's `deploy/prod/local.env`, together with
  `COMPOSE_PROFILES=dockhand`. The repository serves no Dockhand unless an operator opts in.
- **Dockhand joins the stack's network** (`raadi_default`, external in Dockhand's own compose file
  on the server), so the proxy reaches it by name. It still publishes only 127.0.0.1:3000; the SSH
  tunnel keeps working.

## Alternatives considered

- **Dockhand's own login only:** first chosen by the owner, then replaced by this. One password in a
  third-party app open to the internet, with no one-time code and no link to staff roles.
- **An IP allow-list** for the owner's home address: breaks whenever that address changes or the owner
  travels.
- **The SSH tunnel only:** the safest; the owner found it impractical.

## Consequences

- Only platform admins with a one-time code reach Dockhand. Switching Dockhand's own login on as well
  is still advised (two locks), but no longer the only one.
- The first platform admin in production is created by hand (no demo users there), with a temporary
  password and the one-time code set up at the first sign-in.
- Dockhand runs from a mutable `:latest` tag outside this repository: keep it updated.
