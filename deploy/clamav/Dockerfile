# syntax=docker/dockerfile:1.12
# ClamAV (GPL-2.0) with the signature database baked into the upstream image,
# so scanning works offline from the first boot. Runs clamd and freshclam as
# the unprivileged clamav user (no root init step).
FROM clamav/clamav:1.5.4@sha256:ebec5bc138401b36ae987caa1a3fa3c3b2a21ed3d51f0bfa5852825e663e67b0
COPY clamd.conf freshclam.conf /etc/raadi/
COPY --chmod=0755 entrypoint.sh /opt/raadi/entrypoint.sh
USER 100:101
ENTRYPOINT ["/sbin/tini", "--", "/opt/raadi/entrypoint.sh"]
