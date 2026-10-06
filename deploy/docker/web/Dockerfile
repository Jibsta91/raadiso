# syntax=docker/dockerfile:1.12
# Next.js web app -> standalone server on distroless Node (non-root, read-only).
# Runtime configuration is read from the environment at request time, so the
# same image runs locally, in staging and in production.

FROM --platform=$BUILDPLATFORM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS base
RUN npm install -g pnpm@10.34.6 turbo@2.11.6 >/dev/null 2>&1
ENV PNPM_HOME=/pnpm CI=true TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS pruned
COPY . .
RUN turbo prune web --docker --out-dir /out

FROM base AS build
COPY .npmrc ./
COPY --from=pruned /out/json/ .
RUN --mount=type=cache,id=raadi-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY --from=pruned /out/full/ .
COPY tsconfig.base.json ./
RUN pnpm turbo run build --filter=web... \
 && pnpm --filter @raadi/service-kit deploy --prod /otel

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
LABEL org.opencontainers.image.source="https://github.com/Jibsta91/raadi.com" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="raadi-web"
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# Turbopack's standalone trace can miss server chunks with pnpm workspaces;
# the server directory is self-contained, so ship it whole.
COPY --from=build /repo/apps/web/.next/server ./apps/web/.next/server
COPY --from=build /repo/apps/web/public ./apps/web/public
# OpenTelemetry is preloaded outside the Next.js bundle (see ADR-0007).
COPY --from=build /otel /otel
ENV NODE_ENV=production NODE_OPTIONS="--enable-source-maps" PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
USER 65532:65532
EXPOSE 3000
ENTRYPOINT ["/nodejs/bin/node", "--import", "/otel/dist/preload.js", "apps/web/server.js"]
