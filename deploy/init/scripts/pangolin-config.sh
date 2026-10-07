#!/usr/bin/env bash
# Tunnel mode (ADR-0034): renders Pangolin's configuration and its Traefik's dynamic file from the
# templates in deploy/pangolin/, and creates the Pangolin admin's password on the first run. Idempotent.
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="pangolin-config"
: "${RAADI_DOMAIN:?}" "${PANGOLIN_DOMAIN:?}"
export RAADI_DOMAIN PANGOLIN_DOMAIN
# shellcheck disable=SC2016 # envsubst's list of variables, not an expansion
vars='${RAADI_DOMAIN} ${PANGOLIN_DOMAIN}'
templates=/opt/raadi/templates/pangolin

umask 077
# Pangolin wants an upper-case letter, a digit and a symbol, so this one is not a plain generated hex
# secret (secrets-init). ./raadi secret-set pangolin_admin_password before the first run picks your own.
pw="${MASTER_DIR}/pangolin_admin_password"
if [[ ! -s "$pw" ]]; then
  printf 'Raadi-%s-1' "$(openssl rand -hex 12)" > "${pw}.tmp" && mv "${pw}.tmp" "$pw"
  info "generated the Pangolin admin password (./raadi secret pangolin_admin_password)"
fi

# Pangolin keeps its SQLite database, keys and logs next to config.yml.
envsubst "$vars" < "${templates}/config.yml.tmpl" > /pangolin/config.yml
chown -R 65532:65532 /pangolin && chmod 0700 /pangolin && chmod 0400 /pangolin/config.yml

mkdir -p /edge/dynamic
envsubst "$vars" < "${templates}/dynamic.yml.tmpl" > /edge/dynamic/pangolin.yml
chown -R 65532:65532 /edge && chmod 0444 /edge/dynamic/pangolin.yml

info "rendered Pangolin's configuration for https://${PANGOLIN_DOMAIN} (resources under ${RAADI_DOMAIN})"
