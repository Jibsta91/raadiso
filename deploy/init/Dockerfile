# syntax=docker/dockerfile:1.12
# raadi-init: one image for every one-shot bootstrap task (secrets, OpenBao,
# databases + migrations, Keycloak realm, dev TLS, startup summary, smoke test).
# Scripts, migrations and the realm template are baked in so production servers
# need nothing but this image and the compose files.
FROM openbao/openbao:2.7.1@sha256:6d2b93856e3fcf7b18ad855a0b51eaba474dc8b79cf554379ea32034797d2acf AS bao
FROM amacneil/dbmate:2.36.0@sha256:520c740c6e0ad73fde2cd1ea7e2b779aaf789d22aca8858f87a478e7094535fb AS dbmate
# ACME client for phone mode's Let's Encrypt certificate (ADR-0022).
FROM goacme/lego:v5.5.2@sha256:1944e8c36055beec47c7de6f15202b41128be75eea0ffa257f0c14d93c5155fd AS lego

FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS migrations
COPY services/ /src/services/
RUN mkdir -p /out && for d in /src/services/*/migrations; do \
      [ -d "$d" ] || continue; \
      svc="$(basename "$(dirname "$d")")"; cp -r "$d" "/out/$svc"; \
    done

# Config templates rendered by secrets-init (deploy/<component>/**/*.tmpl).
FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS templates
COPY deploy/ /src/deploy/
RUN mkdir -p /out && cd /src/deploy && find . -name '*.tmpl' | tar -cf - -T - | tar -xf - -C /out

FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache bash curl jq openssl ca-certificates coreutils gettext postgresql17-client apache2-utils \
 && addgroup -S -g 65532 raadi && adduser -S -D -H -u 65532 -G raadi raadi
COPY --from=bao /usr/bin/bao /usr/local/bin/bao
COPY --from=dbmate /usr/local/bin/dbmate /usr/local/bin/dbmate
COPY --from=lego /lego /usr/local/bin/lego
COPY --from=migrations /out/ /opt/raadi/migrations/
COPY --from=templates /out/ /opt/raadi/templates/
COPY deploy/init/manifest.json /opt/raadi/manifest.json
COPY deploy/keycloak/realm-raadi.json /opt/raadi/keycloak/realm-raadi.json
COPY deploy/keycloak/realm-bankid-mock.json /opt/raadi/keycloak/realm-bankid-mock.json
COPY deploy/openfga/model.json /opt/raadi/openfga/model.json
COPY packages/events/schemas/ /opt/raadi/events/schemas/
COPY deploy/init/scripts/ /opt/raadi/bin/
COPY tests/smoke/smoke.sh /opt/raadi/bin/smoke.sh
COPY tests/fixtures/ /opt/raadi/fixtures/
RUN chmod 0755 /opt/raadi/bin/*.sh
ENV PATH="/opt/raadi/bin:${PATH}" \
    SECRETS_DIR=/secrets
WORKDIR /opt/raadi
# Unprivileged by default. Compose grants root only to the bootstrap tasks that
# create and chown secret files for other containers (see deploy/compose/init.yaml).
USER 65532:65532
ENTRYPOINT ["/bin/bash"]
