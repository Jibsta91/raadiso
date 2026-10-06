# syntax=docker/dockerfile:1.12
# Upstream image is distroless (no shell); add a static busybox so compose
# healthchecks can probe the HTTP readiness endpoint. Nothing else changes.
FROM busybox:1.38.0-musl@sha256:ea2b9914a16a4ac1981994af97b318f7c7d4db76b580c56177f08bf76f4a0be8 AS busybox
FROM grafana/loki:3.7.8@sha256:1107dd5274e0ada47e42472b7a7e71f3b2a2fe878878108f3e2f9e51528f0193
COPY --from=busybox /bin/busybox /usr/local/bin/busybox
USER 10001:10001
