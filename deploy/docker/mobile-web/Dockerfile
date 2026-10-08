# syntax=docker/dockerfile:1.12
# The Expo app's web export, served under /m by a small static server on distroless Node (non-root,
# read-only). The gateway routes /m here; the app signs in through the website's session (ADR-0021).

FROM --platform=$BUILDPLATFORM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS base
RUN npm install -g pnpm@10.34.6 turbo@2.11.6 >/dev/null 2>&1
ENV PNPM_HOME=/pnpm CI=true TURBO_TELEMETRY_DISABLED=1 EXPO_NO_TELEMETRY=1
WORKDIR /repo

FROM base AS pruned
COPY . .
RUN turbo prune mobile --docker --out-dir /out

FROM base AS build
# GlitchTip's public project key (ADR-0038): public by design, baked into the web export like the app's.
ARG GLITCHTIP_PUBLIC_KEY=""
ARG GLITCHTIP_PROJECT_ID=""
COPY .npmrc ./
COPY --from=pruned /out/json/ .
RUN --mount=type=cache,id=raadi-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY --from=pruned /out/full/ .
COPY tsconfig.base.json ./
RUN pnpm turbo run build --filter=@raadi/service-kit --filter=@raadi/catalog \
 && MOBILE_WEB_BASE_URL=/m GLITCHTIP_PUBLIC_KEY="$GLITCHTIP_PUBLIC_KEY" GLITCHTIP_PROJECT_ID="$GLITCHTIP_PROJECT_ID" \
    pnpm --filter mobile build \
 && pnpm --filter @raadi/service-kit deploy --prod /otel

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
LABEL org.opencontainers.image.source="https://github.com/Jibsta91/raadi.com" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="raadi-mobile-web"
WORKDIR /app
COPY --from=build /repo/apps/mobile/dist ./dist
COPY --from=build /repo/apps/mobile/server/serve.mjs ./serve.mjs
# OpenTelemetry is preloaded, as for the web app (see ADR-0007).
COPY --from=build /otel /otel
ENV NODE_ENV=production PORT=8080 BASE_PATH=/m DIST_DIR=/app/dist
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/nodejs/bin/node", "--import", "/otel/dist/preload.js", "serve.mjs"]
