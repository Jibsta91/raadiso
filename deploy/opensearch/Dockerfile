# syntax=docker/dockerfile:1.12
# OpenSearch with only the security plugin: the bundled ML, alerting, SQL,
# k-NN and other plugins cost memory and start-up time that a single-purpose
# listings index does not need (ADR-0011 budget).
FROM opensearchproject/opensearch:3.9.0@sha256:adfa61f85025d06b4aeb562e7e74fde7e31c437039c93c3862c17e9acebd6c7c
# Delete the plugin directories directly: `opensearch-plugin remove` starts a JVM per plugin and refuses
# plugins others depend on, which took over four minutes of build time. --purge removed the same
# plugins/, bin/ and config/ directories.
RUN for d in plugins/*/; do \
      p="$(basename "$d")"; \
      [ "$p" = opensearch-security ] || rm -rf "plugins/$p" "bin/$p" "config/$p"; \
    done \
 && test "$(bin/opensearch-plugin list)" = "opensearch-security"
COPY --chown=1000:1000 opensearch.yml config/opensearch.yml
COPY --chown=1000:1000 security/ config/opensearch-security/
COPY --chmod=0755 entrypoint.sh /opt/raadi/entrypoint.sh
USER 1000
ENTRYPOINT ["/opt/raadi/entrypoint.sh"]
CMD ["opensearch"]
