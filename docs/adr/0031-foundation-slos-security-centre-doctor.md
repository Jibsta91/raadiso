# 0031 — Foundation, revisited: SLOs and journey probes, a security centre, doctor, accessibility gate

- Status: Accepted
- Date: 2026-10-05

## Context

Phase 1 laid the foundation: the stack, identity, observability and the developer loop. Three phases later
some foundations lagged behind what was built on them. Alerts fired on symptoms (5xx rate, latency) but
nothing said how reliable Raadiso is promised to be, or how much of that has been spent. The status page
showed only whether each container answered right now. People could not see where they were signed in or
manage passkeys without Keycloak's own account console. A cold start on a machine without enough memory, a
port in use or a wedged Docker VM failed halfway with an unrelated error. And nothing checked accessibility.

## Decision

- **Service level objectives** as Prometheus recording rules (`rules/slo.yml`): six SLOs over a rolling
  7-day window (Prometheus keeps 7 days): website availability 99.5 %, API availability 99.9 %, pages within
  1.2 s 95 %, search within 300 ms 95 %, sign-ins 99 %, synthetic journeys 99.5 %. Each records its error
  ratio over 5 m to 7 d and its remaining error budget. Alerts follow the multi-window, multi-burn-rate
  method of the Google SRE workbook (14.4× over 1 h and 5 m pages; 6× over 6 h and 30 m tickets), plus
  "budget exhausted". Request-based SLIs come from Traefik and identity-bff metrics already exported; idle
  periods count as neither good nor bad.
- **Synthetic journeys**: the Prometheus blackbox exporter (Apache-2.0, ≈ 25 MB) probes six journeys every
  30 s through the gateway with the public host names (front page, search page, search API, sign-in
  discovery, console, app on the web). Prometheus renders the target list with the domain at start.
- **Public status page** (`/status`): each journey hour by hour for 7 days, the SLOs with attainment and
  error budget left, and component readiness. Grafana gets a **Raadi · SLOs** dashboard.
- **A security centre on the website** (`/account/security`): where you are signed in (browser, system, apps,
  address, last active; sign out one session or all others), passkeys, authenticator app and password, and a
  short checkup score. identity-bff calls Keycloak's Account REST API with the user's own token (audience
  `account`, role manage-account): no new privileges. Adding a passkey, an authenticator or a new password
  uses Keycloak application-initiated actions (`/auth/login?action=…`) and returns to the page; removing a
  method needs a sign-in within 15 minutes (`/auth/login?reauth=1` gets a fresh one). The realm enables
  passkey sign-in (conditional UI on Keycloak's login page).
- **`./raadi doctor`** checks the machine before `up` (Docker and Compose versions, memory and CPUs for
  containers, free disk inside Docker, checkout under /home on Docker Desktop for Linux, `.env`, name
  resolution, ports 80/443, clock skew, unhealthy services) and prints a fix for each problem. `./raadi up`
  runs it first (`RAADI_SKIP_DOCTOR=1` skips). **`./raadi status`** shows health, memory against each
  limit and CPU for every service.
- **Accessibility gate**: Playwright runs axe-core (MPL-2.0) on the main website pages in light and dark
  mode, on signed-in pages and on the console, against WCAG 2.2 A/AA. Serious and critical findings fail the
  run.

## Alternatives considered

- **Sloth or Pyrra to generate SLO rules**: good tools, but one more generator and CRD-style spec for six
  SLOs; the rules are plain and reviewed as code.
- **30-day SLO windows**: the industry default, but Prometheus keeps 7 days here (ADR-0011's disk budget).
  Longer windows wait for long-term storage in Phase 5.
- **Probing services directly instead of through the gateway**: cheaper, but misses Traefik, its routing and
  middlewares, which visitors depend on.
- **Keycloak's account console for security settings**: complete, but a different look and language, and
  people leave Raadiso to use it. The Account API gives the same data inside our design.
- **Lighthouse CI for accessibility**: page-level scores rather than rule failures with selectors, and a
  second browser runtime; axe runs inside the existing Playwright suite.

## Consequences

- One more container (blackbox exporter); Prometheus starts through a shell to render the journey targets.
- The status page queries Prometheus on each view (three instant and one range query).
- New smoke checks (probes, SLO rules, re-authentication, the security API) and e2e specs (security centre
  with a virtual WebAuthn authenticator: register a passkey, sign in with it, remove it; accessibility).
- Fixed on the way: the listing page's facts list was invalid HTML for screen readers; the console's avatar
  and pill colours missed contrast; the moderation queue nested a checkbox inside an option.
