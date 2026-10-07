# 0037 — Renovate for dependency updates

- Status: Accepted
- Date: 2026-10-08

## Context

Everything is pinned exactly (CLAUDE.md): image digests, npm versions, GitHub Actions digests, toolbox CLIs,
Traefik plugins. That is safe, but pins go stale quietly, and a security fix arrives only when someone
bumps the pin. A `renovate.json` has been in the repository since Phase 1, but nothing ran it: the
hosted Renovate app was never installed, and the compose files under `deploy/compose/` and most toolbox
CLIs were outside its patterns.

## Decision

- **Renovate (AGPL-3.0) runs self-hosted**, as a pinned container: `./raadi renovate` by hand, and every
  Monday morning on the self-hosted runner (ADR-0036, `.github/workflows/renovate.yaml`). It needs a
  fine-grained GitHub token limited to this repository (contents, pull requests, issues and workflows:
  read and write), stored with `./raadi secret-set renovate_token` locally and as the repository secret
  `RENOVATE_TOKEN` for the workflow.
- **The existing configuration stays** (groups for OpenTelemetry, NestJS, Next.js + React and the Grafana
  stack, TypeScript and Node.js limits, majors only after approval on the dependency dashboard issue), and
  gains:
  - the compose files under `deploy/compose/`;
  - every version marked `# renovate: datasource=… depName=…` (all toolbox CLIs, Pangolin's Traefik
    plugins), replacing the hard-coded toolbox list;
  - images pinned inside workflow steps;
  - the `full-stack` label on image updates, so CI runs the whole stack on them (ADR-0036);
  - no package-by-package updates of the Expo SDK in `apps/mobile` (it moves as one with `expo upgrade`).
- **Nothing merges by itself.** Renovate opens pull requests; the user merges them, as with every other
  change.

## Alternatives considered

- **The hosted Renovate app (Mend):** no runner needed, but a third-party service with write access to the
  repository (ADR-0009).
- **Dependabot:** built into GitHub, but it doesn't read our compose files under `deploy/compose/` or
  version comments, and it groups updates less well.
- **Bumping by hand:** what happened so far; pins drifted.

## Consequences

- Expect a burst of pull requests at first (135 updates were pending on 2026-10-08), limited to 8 open and
  4 an hour, then a few a week.
- Commits on Renovate's branches are not signed; the squash merge into `main` is signed by GitHub, as for
  every pull request.
- Renovate's own image is pinned in two places (the `renovate` service and the workflow); Renovate updates
  both.
