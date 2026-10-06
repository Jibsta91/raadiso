# syntax=docker/dockerfile:1.12
# Kafka Connect with the Debezium connectors. The wrapper reads the worker's
# SCRAM password from the secrets mount; connector configs reference secrets
# through DirectoryConfigProvider, so none are stored in the config topic.
FROM quay.io/debezium/connect:3.7.0.Final@sha256:79265cb2c2b9d901bf3c24f4e09e40d06f14987b6bcba0f6e0e06d3f1ddc1fbb
COPY --chmod=0755 entrypoint.sh /opt/raadi/entrypoint.sh
USER kafka
ENTRYPOINT ["/opt/raadi/entrypoint.sh"]
CMD ["start"]
