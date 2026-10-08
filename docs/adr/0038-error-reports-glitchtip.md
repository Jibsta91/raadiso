# 0038 — Error reports from the website and the app: GlitchTip

- Status: Accepted
- Date: 2026-10-08

## Context

Server-side errors are visible: every service sends OpenTelemetry traces, logs and metrics to Grafana
(ADR-0007). Errors in the browser and in the app are not. When the app crashes on a tester's phone, or a
page breaks in someone's browser, we hear about it only if they tell us, and without a stack trace. Tunnel
mode (ADR-0034) brings testers outside the laptop, which makes this gap bigger.

## Decision

- **GlitchTip 6 (MIT)** collects them. It speaks Sentry's protocol, so the apps use Sentry's SDKs (MIT):
  `@sentry/browser` on the website and `@sentry/react-native` in the app and its web build. One container
  runs the web server and the worker together, on its own PostgreSQL database (`glitchtip`, from
  db-init), with no Valkey. It uses about 200 MB of memory.
- **Reports arrive on the site's own address.** The intake (`/errors/api/<project>/envelope/`) is a
  gateway route on the website's and the console's hosts, and nothing else of GlitchTip is reachable
  there. The CSP stays `connect-src 'self'`, and the same build works on `raadi.localhost`, in phone mode,
  in tunnel mode (through the public resource and the VPN) and later in production. The UI is
  `errors.<domain>`, a dev tool like Grafana, signed in with `admin@raadi.localhost` and
  `./raadi secret glitchtip_admin_password`.
- **Set up as code.** `glitchtip-init` creates the admin, the organisation "Raadiso" and the project
  "Raadiso apps" (`deploy/glitchtip/bootstrap.py`), with the project key from `GLITCHTIP_PUBLIC_KEY`. A
  DSN's key is public by design (it ships inside the apps), so the development key is fixed in `.env`, and
  the apps build the DSN from their own origin. An empty key turns reporting off.
- **No personal data** (GDPR, CLAUDE.md). The SDKs collect nothing about the user: no user, IP address,
  cookies, headers, request bodies, query strings or breadcrumbs, and a `beforeSend` removes them again.
  GlitchTip scrubs at ingest as well: IP addresses, e-mail addresses and the `ip_address`, `email` and
  `username` keys become `[Filtered]` (tested with an event that carried all three). Reports are kept 30
  days.
- **Errors only:** no performance tracing (OpenTelemetry covers it), session replay or feedback widget.
- **Licences:** `@sentry/react-native` depends on `@sentry/cli` (FSL-1.1-MIT): Fair Source, commercial use
  allowed except a competing product, MIT two years after each release. It only uploads source maps at
  build time; its download script doesn't run (pnpm blocks it), and it ships in no app. It is on the
  allow-list of `tests/licenses/check-licenses.mjs` (ADR-0009) and may stay in Phase 5.

## Alternatives considered

- **Sentry, self-hosted:** the original, but about 40 containers and 16 GB of memory, and under the FSL.
- **Sentry's or GlitchTip's hosted service:** reports with stack traces would leave our machines, and need
  an account (ADR-0009).
- **OpenTelemetry in the browser and the app:** real-user monitoring in OpenTelemetry is still young, and
  Grafana shows traces, not grouped errors with stack traces.
- **Bugsink:** small, but its licence (Polyform Shield) restricts competing use, and it's newer.

## Consequences

- Today's development build and Expo Go have no Sentry native module: the app reports JavaScript errors
  only. The next development build includes the native module, and then native crashes are reported too.
- Stack traces of the production website and app are minified until source maps are uploaded; that comes
  with the Phase 5 builds.
- `GLITCHTIP_PROJECT_ID` must match the project's id; in a new database it is 1, and glitchtip-init stops
  with a hint if not.
