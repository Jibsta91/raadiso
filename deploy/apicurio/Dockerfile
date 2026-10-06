# syntax=docker/dockerfile:1.12
# Apicurio Registry 3 (event schema registry) on PostgreSQL. The wrapper reads
# the database password from the secrets mount.
FROM apicurio/apicurio-registry:3.3.3@sha256:c9cae4c90ce46538abf673c68eb591345f23bcc6c2aa6bfd47189adcf609d8f1
COPY --chmod=0755 entrypoint.sh /opt/raadi/entrypoint.sh
USER 1001
ENTRYPOINT ["/opt/raadi/entrypoint.sh"]
