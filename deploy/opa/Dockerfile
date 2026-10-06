# syntax=docker/dockerfile:1.12
# Open Policy Agent (static, distroless) plus busybox for the healthcheck probe.
FROM busybox:1.38.0-musl@sha256:ea2b9914a16a4ac1981994af97b318f7c7d4db76b580c56177f08bf76f4a0be8 AS busybox
FROM openpolicyagent/opa:1.21.1-static@sha256:4675ab04ad1627f74741d2d9c5142698c79e18b7b09f192587d31d6dba20838e
COPY --from=busybox /bin/busybox /usr/local/bin/busybox
COPY policies/ /policies/
USER 1000:1000
