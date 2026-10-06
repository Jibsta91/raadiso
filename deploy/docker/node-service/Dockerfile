# syntax=docker/dockerfile:1.12
# Shared image recipe for every TypeScript (NestJS) service.
#   docker build -f deploy/docker/node-service/Dockerfile --build-arg SERVICE=identity-bff .
# Stages: prune (turbo) -> build -> deploy (prod deps only) -> distroless runtime.
# Build stages run on the build platform; production dependencies are pure JS,
# so the multi-arch result needs no emulation.

FROM --platform=$BUILDPLATFORM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
RUN npm install -g pnpm@10.34.6 turbo@2.11.6 >/dev/null 2>&1
ENV PNPM_HOME=/pnpm CI=true TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS pruned
ARG SERVICE
COPY . .
RUN turbo prune "${SERVICE}" --docker --out-dir /out

FROM base AS build
ARG SERVICE
COPY .npmrc ./
COPY --from=pruned /out/json/ .
RUN --mount=type=cache,id=raadi-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY --from=pruned /out/full/ .
COPY tsconfig.base.json ./
RUN pnpm turbo run build --filter="${SERVICE}..." \
 && pnpm --filter "${SERVICE}" deploy --prod /app \
 && rm -rf /app/src /app/test

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
ARG SERVICE
LABEL org.opencontainers.image.source="https://github.com/Jibsta91/raadi.com" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="raadi-${SERVICE}"
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production NODE_OPTIONS="--enable-source-maps"
USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "--import", "./dist/telemetry.js", "dist/main.js"]
