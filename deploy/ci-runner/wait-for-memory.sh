#!/usr/bin/env bash
# Waits until Docker's VM has enough free memory for a CI step (ADR-0036). The runner shares the laptop with
# the developer's stack, so a heavy job waits instead of being killed (exit 137) halfway through.
#   wait-for-memory.sh <GiB needed> [minutes to wait, default 30]
set -euo pipefail
need_gib="${1:?usage: wait-for-memory.sh <GiB> [minutes]}"
minutes="${2:-30}"
need_kib=$((need_gib * 1024 * 1024))
deadline=$((SECONDS + minutes * 60))

available() { awk '/^MemAvailable:/ { print $2 }' /proc/meminfo; }

while :; do
  free_kib="$(available)"
  if ((free_kib >= need_kib)); then
    echo "$((free_kib / 1024 / 1024)) GiB free, ${need_gib} GiB needed: going ahead"
    exit 0
  fi
  if ((SECONDS >= deadline)); then
    echo "::error::Only $((free_kib / 1024 / 1024)) GiB free after ${minutes} min, ${need_gib} GiB needed. Stop the dev stack (./raadi down) and re-run the job."
    exit 1
  fi
  echo "::notice::$((free_kib / 1024 / 1024)) GiB free, ${need_gib} GiB needed: waiting (the dev stack is probably running)"
  sleep 60
done
