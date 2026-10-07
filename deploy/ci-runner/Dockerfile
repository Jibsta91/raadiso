# syntax=docker/dockerfile:1.12@sha256:93bfd3b68c109427185cd78b4779fc82b484b0b7618e36d0f104d4d801e66d25
# GitHub Actions runner for this repository (ADR-0036): the official runner image plus Docker Compose, which
# every CI step needs (./raadi runs everything through compose).
FROM docker/compose-bin:v5.5.1@sha256:14162382692aae43977f79effa64a499d61de19d4645461881daaf88773f7e74 AS compose

FROM ghcr.io/actions/actions-runner:2.338.0@sha256:4ffadc0002b2581327e06101fc8c06cd189232baf79fe561fac9caeb76f5e807
COPY --from=compose /docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
COPY deploy/ci-runner/start.sh /usr/local/bin/raadi-runner
USER root
# The runner's credentials live in a volume mounted here; a new volume takes this owner.
RUN install -d -o runner -g runner -m 0700 /config
USER runner
ENTRYPOINT ["/usr/local/bin/raadi-runner"]
