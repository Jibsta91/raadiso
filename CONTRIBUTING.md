# Contributing

Docker is the only prerequisite. Every tool runs in the `toolbox` container through `./raadi` (or `make`).

1. Read [docs/roadmap.md](docs/roadmap.md), [docs/development.md](docs/development.md) and the
   [ADRs](docs/adr/README.md). Decisions recorded there are not reopened without a new ADR.
2. Start the stack and check it is green before you change anything:
   `./raadi up && ./raadi smoke && ./raadi e2e`.
3. Keep commits small and working; each one should leave the stack green.
4. Before you push, run the gates. GitHub Actions are switched off (since 2026-10-05), so these local runs are
   the check:
   `./raadi lint && ./raadi typecheck && ./raadi test && ./raadi test-integration && ./raadi licenses && ./raadi security && ./raadi iac-scan`.

## Branches and pull requests

Every change to `main` goes through a pull request with signed commits; force-pushes and deletion are not
allowed. GitHub Actions are switched off, so no CI job runs on the pull request: run the gates above (and
`./raadi smoke && ./raadi e2e` for anything beyond docs) on a branch that is up to date with `main`. No review
approval is required. `.github/workflows/ci.yaml` is kept, so CI can be switched back on.

1. Branch from `main` with a short prefix: `feat/`, `fix/`, `chore/`, `docs/` or `refactor/`.
2. Open a pull request and fill in the template. Its title becomes the commit message on `main`, so write it
   in the imperative mood ("Add notifications service").
3. Merge with **Squash and merge** once the local gates pass. The branch is deleted automatically.

Releases are signed SemVer tags with GitHub Releases; see [docs/releasing.md](docs/releasing.md). Label pull
requests (`enhancement`, `bug`, `security`, `dependencies`, `documentation`, `chore`) so release notes group
them.

Report security problems privately (see [SECURITY.md](SECURITY.md)), not in an issue.

## Conventions

- Pin exact versions (never `latest`); Renovate proposes upgrades.
- Only free dependencies, OSI first; a non-OSI licence is recorded with its class
  ([ADR-0009](docs/adr/0009-open-source-licensing-policy.md)).
- New services follow the checklist in [docs/development.md](docs/development.md#adding-a-nestjs-service-checklist).
- Secrets come only from OpenBao; no personal data in logs or events.
- Write an ADR for every significant decision ([format](docs/adr/0001-record-architecture-decisions.md)).
