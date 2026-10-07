# 0035 — CrowdSec as a WAF at the tunnel's edge (no IP bans yet)

- Status: Accepted
- Date: 2026-10-08

## Context

Tunnel mode (ADR-0034) puts Pangolin's Traefik on the internet. Scanners find a new public name within hours
and try known exploits (`/.env`, `/.git/config`, PHPUnit's `eval-stdin.php`, CVE payloads). Pangolin's
sign-in stops them from reaching the stack, but every probe still reaches Pangolin, and once a tester is
signed in, their requests are not checked at all. Phase 6 plans CrowdSec and a WAF for production.

CrowdSec's usual setup reads access logs and bans addresses that misbehave. That needs each visitor's real
address. Here, every request arrives from the same address: Docker Desktop's port forwarding replaces the
visitor's address with the Docker network's gateway (`172.20.0.1`). Pangolin's own request log shows the
same. A ban would lock everyone out, and whitelisting the gateway would make bans do nothing.

## Decision

- **CrowdSec 1.8 (MIT) runs in tunnel mode as a WAF only.** Its AppSec component checks every request that
  reaches Pangolin's Traefik, including Pangolin's own routes, against CrowdSec's virtual patches for known
  CVEs (`crowdsecurity/virtual-patching`, about 200 rules, chosen for low false positives) and answers 403
  when one matches. The Traefik bouncer plugin (Apache-2.0) runs in its `appsec` mode: no ban decisions.
- **Nothing leaves the laptop.** CrowdSec's online API (signal sharing and the community blocklist) is off.
  The rules come from the CrowdSec hub when the container starts, like the Badger plugin (ADR-0034).
- **It fails open.** If CrowdSec is down or slow, requests pass: this is a development tunnel, and
  Pangolin's sign-in still applies. In production the WAF would fail closed.
- **The bouncer key** is a generated secret (`crowdsec_bouncer_key`, secrets-init), registered by CrowdSec
  at start and read by the plugin from a file (`crowdsecLapiKeyFile`).

## Alternatives considered

- **Log scenarios and IP bans now:** impossible to do right behind Docker Desktop's port forwarding (see
  Context). They become possible on the Phase 5 server with Docker Engine, where the bouncer can switch to
  `stream` mode and CrowdSec can read the access log.
- **The full AppSec profile (`appsec-default` plus generic rules, an OWASP CRS-like set):** catches more,
  but blocks legitimate requests more often (rich text, JSON with code, uploads). It can come with the
  Phase 6 hardening, tuned against the e2e suite.
- **Coraza with the OWASP CRS in Traefik:** planned for Phase 6 at our own gateway. CrowdSec was chosen here
  because Pangolin supports it directly, and it can later ban as well.

## Consequences

- Probes for known exploits get a 403 at the edge before Pangolin or the stack sees them.
- CrowdSec adds about 100 MB of memory in tunnel mode only, and needs the internet at start to fetch the
  rules.
- Every tunnel visitor shares one address as far as the edge can tell. That also limits Pangolin's IP and
  country rules and its rate limits (ADR-0034).
- See what it blocked: `docker exec raadi-crowdsec-1 cscli alerts list`; rules:
  `docker exec raadi-crowdsec-1 cscli appsec-rules list`.
