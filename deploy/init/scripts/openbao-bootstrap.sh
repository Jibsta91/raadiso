#!/usr/bin/env bash
# Configures OpenBao: KV v2, AppRole auth, one least-privilege policy and
# AppRole per service, and syncs each service's secrets into
# secret/raadi/<service>. Services read secrets only from OpenBao at startup.
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="openbao-bootstrap"

export BAO_ADDR="${BAO_ADDR:-http://openbao:8200}"
BAO_TOKEN="$(cat "${SECRETS_DIR}/_openbao/root_token")"
export BAO_TOKEN
umask 077

retry 30 bao status >/dev/null || die "OpenBao is not reachable/unsealed"

bao secrets list -format=json | jq -e '."secret/"' >/dev/null \
  || bao secrets enable -path=secret -version=2 kv >/dev/null
bao auth list -format=json | jq -e '."approle/"' >/dev/null \
  || bao auth enable approle >/dev/null

# Shared secrets (e.g. Valkey) — readable only by services that declare them.
for shared in $(jq -r '.shared | keys[]' "$MANIFEST"); do
  args=()
  while IFS=$'\t' read -r key src; do args+=("${key}=$(secret "$src")"); done \
    < <(jq -r --arg s "$shared" '.shared[$s] | to_entries[] | [.key, .value] | @tsv' "$MANIFEST")
  bao kv put -mount=secret "raadi/shared/${shared}" "${args[@]}" >/dev/null
done

for svc in $(jq -r '.services | keys[]' "$MANIFEST"); do
  uid=$(jq -r --arg s "$svc" '.services[$s].uid' "$MANIFEST")

  args=()
  while IFS=$'\t' read -r key src; do args+=("${key}=$(secret "$src")"); done \
    < <(jq -r --arg s "$svc" '.services[$s].openbao // {} | to_entries[] | [.key, .value] | @tsv' "$MANIFEST")
  # Secrets the operator supplies (./raadi secret-set), synced only once they exist.
  while IFS=$'\t' read -r key src; do
    if [[ -s "${MASTER_DIR}/${src}" ]]; then args+=("${key}=$(secret "$src")"); fi
  done < <(jq -r --arg s "$svc" '.services[$s].supplied // {} | to_entries[] | [.key, .value] | @tsv' "$MANIFEST")
  (( ${#args[@]} )) && bao kv put -mount=secret "raadi/${svc}" "${args[@]}" >/dev/null

  {
    printf 'path "secret/data/raadi/%s" { capabilities = ["read"] }\n' "$svc"
    for shared in $(jq -r --arg s "$svc" '.services[$s].shared // [] | .[]' "$MANIFEST"); do
      printf 'path "secret/data/raadi/shared/%s" { capabilities = ["read"] }\n' "$shared"
    done
    printf 'path "auth/token/renew-self" { capabilities = ["update"] }\n'
    printf 'path "auth/token/lookup-self" { capabilities = ["read"] }\n'
  } | bao policy write "$svc" - >/dev/null

  bao write "auth/approle/role/${svc}" token_policies="$svc" token_ttl=1h token_max_ttl=24h \
    secret_id_ttl=0 token_type=service >/dev/null

  dir="${SECRETS_DIR}/approle/${svc}"
  mkdir -p "$dir"
  bao read -field=role_id "auth/approle/role/${svc}/role-id" > "$dir/role_id"
  if [[ ! -s "$dir/secret_id" ]]; then
    bao write -f -field=secret_id "auth/approle/role/${svc}/secret-id" > "$dir/secret_id"
    info "issued AppRole secret-id for ${svc}"
  fi
  chown "$uid:0" "$dir" "$dir/role_id" "$dir/secret_id"
  chmod 0400 "$dir/role_id" "$dir/secret_id"; chmod 0500 "$dir"
done

info "OpenBao configured for $(jq -r '.services | length' "$MANIFEST") service(s)"
