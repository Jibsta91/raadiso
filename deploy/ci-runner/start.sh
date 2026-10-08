#!/usr/bin/env bash
# The self-hosted GitHub Actions runner for ${GITHUB_REPOSITORY} (ADR-0036).
#   register — one-off: registers this runner with a registration token (valid for one hour) read from
#              stdin, and keeps the runner's own credentials in /config (the ci-runner-config volume).
#   (none)   — runs the registered runner. No GitHub token is stored anywhere.
set -euo pipefail
repo="${GITHUB_REPOSITORY:?}"
work="${RUNNER_WORK:?}"
files=(.runner .credentials .credentials_rsaparams)
cd /home/runner
mkdir -p "$work"

if [[ "${1:-}" == register ]]; then
  read -r token
  [[ -n "$token" ]] || { echo "no registration token given" >&2; exit 2; }
  ./config.sh --unattended --replace --url "https://github.com/${repo}" --token "$token" \
    --name "raadi-$(hostname -s)" --labels raadi --work "$work" --disableupdate
  for f in "${files[@]}"; do mv "$f" "/config/$f"; done
  echo "registered; start it with ./raadi runner start"
  exit 0
fi

[[ -s /config/.runner ]] || { echo "not registered: run ./raadi runner register" >&2; sleep 60; exit 1; }
for f in "${files[@]}"; do ln -sf "/config/$f" "$f"; done
exec ./run.sh
