# syntax=docker/dockerfile:1.12
# Development image for hot reload (compose.dev.yaml): Node + pnpm + turbo.
# Source is bind-mounted at /workspace; node_modules live in named volumes
# shared with the toolbox (both glibc-based, so native binaries match).
FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
RUN npm install -g pnpm@10.34.6 turbo@2.11.6 >/dev/null 2>&1 && mkdir -p /pnpm/store
ENV PNPM_HOME=/pnpm npm_config_store_dir=/pnpm/store CI=true TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace
