#!/usr/bin/env bash
# Toolbox entrypoint: friendly subcommands, anything else is executed as-is
# (e.g. `docker compose run --rm toolbox tofu -version`).
set -euo pipefail
cd /workspace

install_deps() {
  # node_modules live in named volumes (never on the host).
  pnpm install --frozen-lockfile --prefer-offline >/tmp/pnpm-install.log 2>&1 \
    || { cat /tmp/pnpm-install.log; exit 1; }
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  help)
    cat <<'HELP'
Raadi toolbox — usage: docker compose run --rm toolbox <command> [args]

  install            pnpm install (into named volumes)
  lint               ESLint + Prettier check + shellcheck
  format             Prettier write
  typecheck          TypeScript across the monorepo
  test               unit + contract tests
  test-integration   Testcontainers integration tests (uses the Docker socket)
  build              build all packages
  generate           regenerate the typed API client (OpenAPI) and event JSON Schemas (zod)
  api-check          generated client and schemas up to date; no breaking OpenAPI change against
                     main (oasdiff); API_BREAKING_OK=1 allows one on purpose
  e2e                Playwright end-to-end tests against the running stack
  security           Trivy (fs + config), Gitleaks, OSV-Scanner
  iac-scan           Checkov + Trivy misconfiguration scan (compose, Dockerfiles, infra/)
  licenses           fail on dependencies neither OSI-approved nor allow-listed
  sbom               write SBOMs (SPDX JSON) to ./sbom
  versions           print tool versions
  <any command>      run it inside the toolbox (tofu, ansible, trivy, pnpm, uv ...)
HELP
    ;;
  install) install_deps ;;
  lint)
    install_deps
    pnpm turbo run lint "$@"
    pnpm exec prettier --check . --log-level warn
    opa fmt --fail --list deploy/opa/policies >/dev/null
    opa check --strict deploy/opa/policies
    # shellcheck disable=SC2046  # word splitting of the file list is intended
    shellcheck -x raadi $(git ls-files "*.sh")
    ;;
  format) install_deps; pnpm exec prettier --write . "$@" ;;
  typecheck) install_deps; pnpm turbo run typecheck "$@" ;;
  test)
    install_deps
    pnpm turbo run test "$@"
    opa test deploy/opa/policies
    ;;
  test-integration)
    install_deps
    # Testcontainers talks to the host's Docker through the mounted socket.
    TESTCONTAINERS_HOST_OVERRIDE="${TESTCONTAINERS_HOST_OVERRIDE:-host.docker.internal}" \
      pnpm turbo run test:integration "$@"
    ;;
  build) install_deps; pnpm turbo run build "$@" ;;
  generate)
    install_deps
    pnpm --filter @raadi/api-client generate
    pnpm --filter @raadi/events generate && pnpm exec prettier --write --log-level warn packages/events/schemas
    ;;
  api-check)
    # 1. The committed client and event schemas match the specs and contracts (./raadi generate was run).
    install_deps
    pnpm --filter @raadi/api-client generate
    pnpm --filter @raadi/events generate && pnpm exec prettier --write --log-level warn packages/events/schemas
    if ! git diff --quiet -- packages/api-client packages/events/schemas; then
      git --no-pager diff --stat -- packages/api-client packages/events/schemas
      echo "✘ the generated client or event schemas are out of date: run ./raadi generate and commit them" >&2
      exit 1
    fi
    echo "✔ generated client and event schemas are up to date"
    # 2. No breaking change in a service's OpenAPI document against the base (default origin/main).
    base="${API_BASE_REF:-origin/main}" broken=0
    git rev-parse --verify --quiet "$base" >/dev/null || { echo "✘ unknown base $base (git fetch?)" >&2; exit 1; }
    for spec in services/*/openapi.yaml; do
      git cat-file -e "$base:$spec" 2>/dev/null || continue # a new service has nothing to break
      git show "$base:$spec" > /tmp/base-openapi.yaml
      if ! oasdiff breaking /tmp/base-openapi.yaml "$spec" --fail-on ERR --format text; then
        echo "✘ breaking change in $spec (against $base)" >&2; broken=1
      fi
    done
    if (( broken )); then
      [[ "${API_BREAKING_OK:-}" == 1 ]] || { echo "Clients would break. If that is on purpose (and every client is updated), run with API_BREAKING_OK=1." >&2; exit 1; }
      echo "! breaking changes allowed by API_BREAKING_OK=1"
    else
      echo "✔ no breaking OpenAPI change against $base"
    fi
    ;;
  e2e) install_deps; pnpm --filter e2e e2e "$@" ;;
  security)
    trivy fs --scanners vuln,secret --ignorefile .trivyignore.yaml --severity HIGH,CRITICAL --exit-code 1 --skip-dirs '**/node_modules' --skip-dirs '**/.next' .
    trivy config --ignorefile .trivyignore.yaml --severity HIGH,CRITICAL --exit-code 1 --skip-dirs '**/node_modules' --skip-dirs '**/.next' .
    gitleaks dir --no-banner --redact --config .gitleaks.toml .
    osv-scanner scan source --lockfile pnpm-lock.yaml
    ;;
  iac-scan)
    checkov --quiet --compact -d . --framework dockerfile,yaml,github_actions,terraform,ansible \
      --skip-path node_modules --skip-path .next --config-file .checkov.yaml "$@"
    trivy config --ignorefile .trivyignore.yaml --severity HIGH,CRITICAL --exit-code 1 --skip-dirs '**/node_modules' --skip-dirs '**/.next' .
    if [[ -n "$(ls infra/tofu 2>/dev/null)" ]]; then (cd infra/tofu && tflint --recursive); fi
    ;;
  licenses) install_deps; node tests/licenses/check-licenses.mjs ;;
  sbom)
    mkdir -p sbom
    syft dir:. --exclude './**/node_modules/**' -o "spdx-json=sbom/raadi-source.spdx.json"
    echo "SBOM written to sbom/"
    ;;
  versions)
    for t in node pnpm turbo uv tofu tflint trivy checkov ansible gitleaks osv-scanner syft opa docker; do
      printf '%-12s %s\n' "$t" "$("$t" --version 2>/dev/null | head -1 || "$t" version 2>/dev/null | head -1)"
    done
    printf '%-12s %s\n' playwright "browsers: $(find /ms-playwright -mindepth 1 -maxdepth 1 -printf '%f ')"
    ;;
  *) exec "$cmd" "$@" ;;
esac
