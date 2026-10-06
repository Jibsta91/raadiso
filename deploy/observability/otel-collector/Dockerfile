# syntax=docker/dockerfile:1.12
# Upstream image is distroless (no shell); add a static busybox so compose
# healthchecks can probe the HTTP readiness endpoint. Nothing else changes.
FROM busybox:1.38.0-musl@sha256:ea2b9914a16a4ac1981994af97b318f7c7d4db76b580c56177f08bf76f4a0be8 AS busybox
FROM otel/opentelemetry-collector-contrib:0.161.0@sha256:fd328de2552466ad78385e1b1289c3f2402b1c45f265b252aab1955b42845ac1
COPY --from=busybox /bin/busybox /usr/local/bin/busybox
USER 10001:10001
