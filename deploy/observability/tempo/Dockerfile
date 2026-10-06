# syntax=docker/dockerfile:1.12
# Upstream image is distroless (no shell); add a static busybox so compose
# healthchecks can probe the HTTP readiness endpoint. Nothing else changes.
FROM busybox:1.38.0-musl@sha256:ea2b9914a16a4ac1981994af97b318f7c7d4db76b580c56177f08bf76f4a0be8 AS busybox
FROM grafana/tempo:2.10.8@sha256:f0561deb1c68ec44d6e6e7e4487f30106c4e5e768642077695b37958b105812a
COPY --from=busybox /bin/busybox /usr/local/bin/busybox
USER 10001:10001
