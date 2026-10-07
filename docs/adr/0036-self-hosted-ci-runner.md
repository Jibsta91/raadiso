# 0036 — CI on a self-hosted runner on the development laptop

- Status: Accepted
- Date: 2026-10-08

## Context

GitHub Actions has been off since 2026-10-05: GitHub's hosted runners took too long to build and start
this stack. Since then the gates run by hand before every pull request (CLAUDE.md), and a pull request on
GitHub shows no proof that they ran. Renovate's update pull requests would each need a manual run too.

The repository is public. A self-hosted runner that ran pull requests from forks would let anyone run code
on the laptop, with the Docker socket (root on Docker's VM).

## Decision

- **GitHub's runner (MIT) runs in a container on the laptop** (`deploy/ci-runner`, the official image plus
  Docker Compose), in the `ci` compose profile. `./raadi runner register` registers it once with a
  registration token (valid for one hour, read from a hidden prompt); the runner then keeps its own
  credentials in a volume. No GitHub token is stored. `./raadi runner start|stop|status` manage it.
- **The workflow runs on it** (`runs-on: [self-hosted, raadi]`) with the same `./raadi` commands as before.
  Every job runs only for pushes and for pull requests whose branch is in this repository; fork pull
  requests are skipped. The repository setting "require approval for all external contributors" is a
  second guard.
- **CI never touches the developer's stack:** its compose project is `raadi-ci`, its images are
  `raadi-ci/*`, and the full-stack job publishes on 18080/18443 and removes its stack and volumes at the end.
- **The full-stack job runs on request:** the `full-stack` label on a pull request, a push to `main`, or a
  manual run. A second stack needs about 7 GB more in Docker.
- **Jobs work with bind mounts:** they talk to the same Docker as the developer, which resolves bind-mount
  paths on the host. So the runner's work folder has the same path in the container and on the host,
  under `$HOME/.cache/raadi-runner`, which Docker Desktop shares.
- The runner's version is pinned and it does not update itself; Renovate (ADR-0037) bumps the image.

## Alternatives considered

- **GitHub's hosted runners:** what we had; too slow without our Docker cache.
- **Ephemeral just-in-time runners:** one clean runner per job, but they need a stored token with
  administration rights on the repository to register each runner.
- **Forgejo or Woodpecker CI next to GitHub:** another service and another place to look, for the same
  checks.
- **A git pre-push hook running the gates:** cheap, but leaves no record on the pull request and is easy
  to skip.

## Consequences

- Turning it on needs the user: Actions on in the repository settings, the fork-approval setting, and one
  `./raadi runner register`. Requiring the check on `main` is optional.
- Jobs run only while the laptop is on; otherwise they wait in GitHub's queue.
- The quality job's toolbox and `node_modules` volumes are separate from the developer's (`raadi-ci_*`), so
  the first run is slow and later ones are cached.
- The runner has the Docker socket. Only this repository's own branches can use it, which is the same
  trust as running the gates by hand.
