#!/usr/bin/env bash
# First-boot secret generation. Idempotent: existing secrets are never
# regenerated. Every secret is random (256 bit) and lives only in the secrets
# volume (dev) or ${DEPLOY_DIR}/secrets (prod) — never in Git or images.
# Infra containers that cannot talk to OpenBao get read-only per-consumer copies.
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="secrets-init"

umask 077
mkdir -p "$MASTER_DIR"
chmod 0700 "$SECRETS_DIR" "$MASTER_DIR"

created=0
for name in $(jq -r '.secrets[]' "$MANIFEST"); do
  f="${MASTER_DIR}/${name}"
  if [[ ! -s "$f" ]]; then
    openssl rand -hex 32 | tr -d "\n" > "${f}.tmp" && mv "${f}.tmp" "$f"
    created=$((created + 1))
  fi
done

# Distribute read-only copies to infra consumers (one directory per container,
# owned by that container's UID, mounted via volume subpath).
for consumer in $(jq -r '.fileConsumers | keys[]' "$MANIFEST"); do
  uid=$(jq -r --arg c "$consumer" '.fileConsumers[$c].uid' "$MANIFEST")
  dir="${SECRETS_DIR}/${consumer}"
  mkdir -p "$dir"
  for name in $(jq -r --arg c "$consumer" '.fileConsumers[$c].secrets[]' "$MANIFEST"); do
    install -m 0400 -o "$uid" -g 0 "${MASTER_DIR}/${name}" "${dir}/${name}"
  done
  chown "$uid:0" "$dir"; chmod 0500 "$dir"
done

# Config files for containers that take credentials only from a file (distroless
# images, or formats such as bcrypt hashes). Templates live next to their
# component under deploy/ and reference secrets as ${name} or ${bcrypt_name}.
render_vars=()
for name in $(jq -r '.secrets[]' "$MANIFEST"); do
  export "${name}=$(cat "${MASTER_DIR}/${name}")"; render_vars+=("\${${name}}")
done
for name in $(jq -r '.bcrypt // [] | .[]' "$MANIFEST"); do
  hash="$(htpasswd -nbBC 10 x "$(cat "${MASTER_DIR}/${name}")" | cut -d: -f2- | tr -d '\n')"
  export "bcrypt_${name}=${hash}"; render_vars+=("\${bcrypt_${name}}")
done
# Cookie keys must be 16, 24 or 32 bytes (oauth2-proxy): the first 32 characters of the secret.
for name in $(jq -r '.cookie // [] | .[]' "$MANIFEST"); do
  export "cookie_${name}=$(head -c 32 "${MASTER_DIR}/${name}")"; render_vars+=("\${cookie_${name}}")
done
while IFS=$'\t' read -r src consumer dest; do
  uid=$(jq -r --arg c "$consumer" '.fileConsumers[$c].uid' "$MANIFEST")
  dir="${SECRETS_DIR}/${consumer}"
  mkdir -p "$dir"
  envsubst "${render_vars[*]}" < "/opt/raadi/templates/${src}" > "${dir}/${dest}.tmp"
  install -m 0400 -o "$uid" -g 0 "${dir}/${dest}.tmp" "${dir}/${dest}"; rm -f "${dir}/${dest}.tmp"
  chown "$uid:0" "$dir"; chmod 0500 "$dir"
done < <(jq -r '.templates // [] | .[] | [.src, .consumer, .dest] | @tsv' "$MANIFEST")
unset "${!bcrypt_@}" "${!cookie_@}"

# Directories for OpenBao AppRole credentials, filled by openbao-bootstrap.
for svc in $(jq -r '.services | keys[]' "$MANIFEST"); do
  uid=$(jq -r --arg s "$svc" '.services[$s].uid' "$MANIFEST")
  mkdir -p "${SECRETS_DIR}/approle/${svc}"
  chown "$uid:0" "${SECRETS_DIR}/approle/${svc}"; chmod 0500 "${SECRETS_DIR}/approle/${svc}"
done
# The unsealer runs as 65532 and sees only this directory (deploy/compose/init.yaml).
mkdir -p "${SECRETS_DIR}/_openbao"
chown -R 65532:65532 "${SECRETS_DIR}/_openbao"; chmod 0700 "${SECRETS_DIR}/_openbao"

info "secrets ready (${created} generated this run)"
