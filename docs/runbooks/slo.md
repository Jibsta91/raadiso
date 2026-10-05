# Service level objectives

Alerts: `SLOFastBurn` (critical), `SLOSlowBurn`, `SLOBudgetExhausted`, `JourneyProbeFailing` (warning).
Decision: [ADR-0031](../adr/0031-foundation-slos-security-centre-doctor.md). Rules:
`deploy/observability/prometheus/rules/slo.yml`. Dashboard: Grafana **Raadi · SLOs**. Public view: `/status`.

| SLO                | Objective (7 days) | Good event                                       |
| ------------------ | ------------------ | ------------------------------------------------ |
| `journeys`         | 99.5 %             | a synthetic probe of a main journey passes       |
| `web_availability` | 99.5 %             | a website response that is not 5xx               |
| `api_availability` | 99.9 %             | an API response (all domain services) not 5xx    |
| `page_latency`     | 95 %               | a website response within 1.2 s                  |
| `search_latency`   | 95 %               | a search response within 300 ms                  |
| `sign_in`          | 99 %               | a sign-in that completes (website, app, console) |

## What the alerts mean

- **Fast burn** (critical): for the last hour, and still in the last 5 minutes, errors arrive at 14.4 times
  the rate the budget allows. Left alone, the 7-day budget is gone in about half a day. Act now.
- **Slow burn**: 6 times the allowed rate over 6 hours (and the last 30 minutes). Look today.
- **Budget exhausted**: the 7-day budget is spent. Reliability work goes before features until it recovers.
- **Journey probe failing**: a synthetic journey (front page, search page, search API, sign-in discovery,
  console, app on the web) has failed for 3 minutes. Visitors see the same.

## First steps

1. Grafana **Raadi · SLOs**: which SLO, since when, and the burn-rate panel. **Synthetic journeys** shows which
   journey fails; the probe's own result is in Prometheus: `probe_success{job="journeys"}`,
   `probe_http_status_code{job="journeys"}`.
2. Map the SLO to its service: `web_*` and `page_latency` → `web`; `search_latency` → `search` and OpenSearch;
   `api_availability` → the 5xx panel of **Raadi · Service health (RED)** names the service; `sign_in` →
   identity-bff, admin-bff and Keycloak ([auth-anomalies.md](auth-anomalies.md)).
3. Follow that service's runbook ([service-down.md](service-down.md),
   [high-error-rate.md](high-error-rate.md)). Traces of failing requests: Grafana Explore → Tempo,
   `{ status = error }`.
4. A probe fails but users report nothing: try the probe by hand from inside the network:
   `docker compose exec blackbox wget -qO- 'http://localhost:9115/probe?module=page&target=http://traefik/en&hostname=raadi.localhost&debug=true'`.

## Changing an objective

Edit `slo.yml` (the comment table, the `slo:objective:ratio` rule and the `sli_error` rules stay together),
check it with `promtool check rules`, and update the table above and in ADR-0031. Prometheus keeps 7 days,
so windows longer than that need long-term storage first (Phase 5).
