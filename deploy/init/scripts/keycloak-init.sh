#!/usr/bin/env bash
# Imports/updates the "raadi" realm through the Keycloak Admin API.
# First run: creates the realm from the template. Later runs: keeps realm
# settings and clients (redirect URIs, secrets) in sync with config, and adds
# missing roles/users without touching existing ones.
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="keycloak-init"

KC="${KEYCLOAK_INTERNAL_URL:-http://keycloak:8080}"
REALM="${KEYCLOAK_REALM:-raadi}"

BFF_CLIENT_SECRET="$(secret bff_oidc_client_secret)"
ADMIN_CLIENT_SECRET="$(secret admin_oidc_client_secret)"
GRAFANA_CLIENT_SECRET="$(secret grafana_oidc_client_secret)"
REGISTRY_INIT_CLIENT_SECRET="$(secret registry_init_client_secret)"
NOTIFICATIONS_CLIENT_SECRET="$(secret notifications_kc_client_secret)"
ADMIN_KC_CLIENT_SECRET="$(secret admin_kc_client_secret)"
DEMO_EMAIL_DOMAIN="${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}"
export DEMO_EMAIL_DOMAIN PUBLIC_BASE_URL ADMIN_BASE_URL AUTH_BASE_URL GRAFANA_BASE_URL RAADI_DOMAIN REALM BFF_CLIENT_SECRET ADMIN_CLIENT_SECRET GRAFANA_CLIENT_SECRET \
  REGISTRY_INIT_CLIENT_SECRET NOTIFICATIONS_CLIENT_SECRET ADMIN_KC_CLIENT_SECRET \
  SMTP_HOST="${SMTP_HOST:-mailpit}" SMTP_PORT="${SMTP_PORT:-1025}" \
  SMTP_FROM="${SMTP_FROM:-no-reply@${RAADI_DOMAIN}}" \
  DEMO_USER_PASSWORD="${DEMO_USER_PASSWORD:-}" DEMO_OTP_SECRET="${DEMO_OTP_SECRET:-}"

# envsubst only replaces this explicit list (Keycloak's own ${...} keys stay intact).
# shellcheck disable=SC2016
vars='$DEMO_OTP_SECRET $PUBLIC_BASE_URL $ADMIN_BASE_URL $AUTH_BASE_URL $GRAFANA_BASE_URL $RAADI_DOMAIN $DEMO_EMAIL_DOMAIN $REALM $SMTP_HOST $SMTP_PORT $SMTP_FROM $DEMO_USER_PASSWORD $BFF_CLIENT_SECRET $ADMIN_CLIENT_SECRET $GRAFANA_CLIENT_SECRET $REGISTRY_INIT_CLIENT_SECRET $NOTIFICATIONS_CLIENT_SECRET $ADMIN_KC_CLIENT_SECRET'
realm="$(envsubst "$vars" < /opt/raadi/keycloak/realm-raadi.json)"
if [[ "${SEED_DEMO_DATA:-false}" != "true" ]]; then
  realm="$(jq 'del(.users)' <<<"$realm")"
fi
# One-time codes are single-use, except in development where KEYCLOAK_OTP_CODE_REUSABLE=true lets a code be
# used again within its 30 s window: tests sign the same demo staff user in several times in a row, and the
# demo code secret is public anyway (DEMO_OTP_SECRET). Anything but "true" keeps codes single-use.
reusable=false
[[ "${KEYCLOAK_OTP_CODE_REUSABLE:-false}" == true ]] && reusable=true
realm="$(jq --argjson r "$reusable" '.otpPolicyCodeReusable = $r' <<<"$realm")"

token() {
  curl -fsS "$KC/realms/master/protocol/openid-connect/token" \
    --data-urlencode client_id=admin-cli --data-urlencode grant_type=password \
    --data-urlencode username="${KEYCLOAK_ADMIN_USER:-admin}" \
    --data-urlencode "password=$(secret keycloak_admin_password)" | jq -r .access_token
}
retry 30 token >/dev/null || die "cannot obtain Keycloak admin token"
TOKEN="$(token)"
api() { curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/$REALM")
if [[ "$code" == "404" ]]; then
  api -X POST "$KC/admin/realms" --data-binary @- <<<"$realm"
  info "realm ${REALM} created"
else
  settings="$(jq 'del(.users, .clients, .roles, .groups, .clientScopes, .components, .authenticationFlows,
    .authenticatorConfig, .requiredActions, .identityProviders, .identityProviderMappers,
    .defaultDefaultClientScopes, .defaultOptionalClientScopes, .defaultRole)' <<<"$realm")"
  api -X PUT "$KC/admin/realms/$REALM" --data-binary @- <<<"$settings"
  # Clients are updated in place: a partial import with OVERWRITE deletes and recreates them,
  # which ends every session that uses them ("Session doesn't have required client") and drops
  # service-account role grants. New clients are created; missing protocol mappers are added.
  while IFS= read -r client; do
    client_id="$(jq -r .clientId <<<"$client")"
    have="$(api -G "$KC/admin/realms/$REALM/clients" --data-urlencode "clientId=$client_id" | jq -r '.[0].id // empty')"
    if [[ -z "$have" ]]; then
      api -X POST "$KC/admin/realms/$REALM/clients" --data-binary "$client" >/dev/null
      info "client ${client_id} created"
      continue
    fi
    jq 'del(.protocolMappers)' <<<"$client" | api -X PUT "$KC/admin/realms/$REALM/clients/$have" --data-binary @- >/dev/null
    existing="$(api "$KC/admin/realms/$REALM/clients/$have/protocol-mappers/models" | jq -c '[.[].name]')"
    while IFS= read -r mapper; do
      api -X POST "$KC/admin/realms/$REALM/clients/$have/protocol-mappers/models" --data-binary "$mapper" >/dev/null
    done < <(jq -c --argjson have "$existing" '.protocolMappers // [] | .[] | select(.name as $n | $have | index($n) | not)' <<<"$client")
  done < <(jq -c '.clients[]' <<<"$realm")
  # Demo users have fixed ids (seed data references them). Recreate any demo
  # user that an older realm created with a random id.
  while IFS=$'\t' read -r want username otp; do
    have="$(api -G "$KC/admin/realms/$REALM/users" --data-urlencode "username=$username" --data-urlencode exact=true \
      | jq -r '.[0].id // empty')"
    if [[ -n "$have" && "$have" != "$want" ]]; then
      api -X DELETE "$KC/admin/realms/$REALM/users/$have" >/dev/null
      info "recreating demo user ${username} with its fixed id"
    elif [[ -n "$have" && "$otp" == "true" ]] \
      && ! api "$KC/admin/realms/$REALM/users/$have/credentials" | jq -e 'any(.[]; .type == "otp")' >/dev/null; then
      # The admin console needs an authenticator (ADR-0028); credentials can only be imported.
      api -X DELETE "$KC/admin/realms/$REALM/users/$have" >/dev/null
      info "recreating demo user ${username} with its development authenticator"
    fi
  done < <(jq -r '.users // [] | .[] | [.id, .username, (any(.credentials[]?; .type == "otp") | tostring)] | @tsv' <<<"$realm")
  jq '{ifResourceExists: "SKIP", roles: .roles, groups: (.groups // []), users: (.users // [])}' <<<"$realm" \
    | api -X POST "$KC/admin/realms/$REALM/partialImport" --data-binary @- >/dev/null
  info "realm ${REALM} updated"
fi

# Self-registered users get the "user" role through the realm's default role.
user_role="$(api "$KC/admin/realms/$REALM/roles/user")"
api -X POST "$KC/admin/realms/$REALM/roles/default-roles-${REALM}/composites" \
  --data-binary "[$user_role]" >/dev/null
info "default role includes 'user'"

# Imported users with explicit realmRoles miss the default role, and with it offline_access, which the
# app needs to stay signed in (ADR-0021). Grant it to the demo users; repeating the grant is harmless.
default_role="$(api "$KC/admin/realms/$REALM/roles/default-roles-${REALM}")"
while read -r id; do
  api -X POST "$KC/admin/realms/$REALM/users/$id/role-mappings/realm" --data-binary "[$default_role]" >/dev/null
done < <(jq -r '.users // [] | .[].id' <<<"$realm")
info "demo users have the default role"

# Existing demo users keep their old role mappings (the import skips existing users), so roles added
# to the realm file later (support, operator) are granted here too. Granting again is harmless.
while IFS=$'\t' read -r id roles; do
  mapping="$(for r in $roles; do api "$KC/admin/realms/$REALM/roles/$r"; done | jq -s -c '.')"
  api -X POST "$KC/admin/realms/$REALM/users/$id/role-mappings/realm" --data-binary "$mapping" >/dev/null
done < <(jq -r '.users // [] | .[] | [.id, (.realmRoles // [] | join(" "))] | @tsv' <<<"$realm")
info "demo users have their realm roles"

# The admin console (client raadi-admin) requires a one-time code for everyone (ADR-0028): a copy
# of the browser flow whose OTP step is required instead of conditional, bound to that client
# only. Staff without an authenticator are asked to set one up at their first sign-in.
FLOW=raadi-admin-browser
if ! api "$KC/admin/realms/$REALM/authentication/flows" | jq -e --arg a "$FLOW" 'any(.[]; .alias == $a)' >/dev/null; then
  api -X POST "$KC/admin/realms/$REALM/authentication/flows/browser/copy" --data-binary "{\"newName\":\"$FLOW\"}" >/dev/null
  info "flow ${FLOW} created"
fi
executions="$(api "$KC/admin/realms/$REALM/authentication/flows/$FLOW/executions")"
while read -r change; do
  api -X PUT "$KC/admin/realms/$REALM/authentication/flows/$FLOW/executions" --data-binary "$change" >/dev/null
done < <(jq -c '.[]
  | if (.displayName | test("Conditional OTP")) and .requirement != "REQUIRED" then .requirement = "REQUIRED"
    elif .displayName == "Condition - user configured" and .requirement != "DISABLED" then .requirement = "DISABLED"
    else empty end' <<<"$executions")
flow_id="$(api "$KC/admin/realms/$REALM/authentication/flows" | jq -r --arg a "$FLOW" '.[] | select(.alias == $a) | .id')"
admin_client="$(api -G "$KC/admin/realms/$REALM/clients" --data-urlencode clientId=raadi-admin | jq -r '.[0].id')"
api "$KC/admin/realms/$REALM/clients/$admin_client" \
  | jq -c --arg f "$flow_id" '.authenticationFlowBindingOverrides = {browser: $f}' \
  | api -X PUT "$KC/admin/realms/$REALM/clients/$admin_client" --data-binary @- >/dev/null
info "admin console requires a one-time code (flow ${FLOW})"

# Service accounts get their client roles here (the realm import cannot express them).
grant_client_role() { # <service-account client> <resource client> <role>
  local sa_client res_client role sa_user
  sa_client="$(api "$KC/admin/realms/$REALM/clients?clientId=$1" | jq -r '.[0].id')"
  res_client="$(api "$KC/admin/realms/$REALM/clients?clientId=$2" | jq -r '.[0].id')"
  sa_user="$(api "$KC/admin/realms/$REALM/clients/$sa_client/service-account-user" | jq -r .id)"
  role="$(api "$KC/admin/realms/$REALM/clients/$res_client/roles/$3")"
  api -X POST "$KC/admin/realms/$REALM/users/$sa_user/role-mappings/clients/$res_client" \
    --data-binary "[$role]" >/dev/null
  info "service account $1 has $2/$3"
}
# New accounts accept the terms of use on their first login (Keycloak's built-in step;
# existing users are not asked again).
api "$KC/admin/realms/$REALM/authentication/required-actions/TERMS_AND_CONDITIONS" \
  | jq '.enabled = true | .defaultAction = true' \
  | api -X PUT "$KC/admin/realms/$REALM/authentication/required-actions/TERMS_AND_CONDITIONS" --data-binary @-
info "new users accept the terms of use"

grant_client_role registry-init apicurio-registry sr-admin
# notifications reads e-mail and language at send time, nothing else.
grant_client_role notifications realm-management view-users
# admin-bff serves the console's user administration (ADR-0030): it finds users, suspends them,
# signs them out, sends account e-mails, changes staff roles and reads login events. Every call
# is made on behalf of a signed-in staff member and recorded in the audit log.
for role in view-users query-users manage-users view-events view-realm; do
  grant_client_role admin-bff realm-management "$role"
done

# --- BankID mock realm (development; ADR-0018) --------------------------------
# A stand-in BankID OIDC provider for the trust service's identity verification,
# with synthetic test people. Production sets BANKID_MOCK=false and points
# BANKID_ISSUER at a real BankID provider.
if [[ "${BANKID_MOCK:-false}" == "true" ]]; then
  TOKEN="$(token)"
  TRUST_BANKID_CLIENT_SECRET="$(secret trust_bankid_client_secret)"
  export TRUST_BANKID_CLIENT_SECRET
  # shellcheck disable=SC2016
  mock="$(envsubst '$PUBLIC_BASE_URL $RAADI_DOMAIN $DEMO_USER_PASSWORD $TRUST_BANKID_CLIENT_SECRET' \
    < /opt/raadi/keycloak/realm-bankid-mock.json)"
  [[ -n "$DEMO_USER_PASSWORD" ]] || mock="$(jq 'del(.users)' <<<"$mock")"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/bankid-mock")
  if [[ "$code" == "404" ]]; then
    api -X POST "$KC/admin/realms" --data-binary @- <<<"$mock"
    info "realm bankid-mock created"
  else
    jq 'del(.users, .clients)' <<<"$mock" | api -X PUT "$KC/admin/realms/bankid-mock" --data-binary @-
    jq '{ifResourceExists: "OVERWRITE", clients: .clients}' <<<"$mock" \
      | api -X POST "$KC/admin/realms/bankid-mock/partialImport" --data-binary @- >/dev/null
    jq '{ifResourceExists: "SKIP", users: (.users // [])}' <<<"$mock" \
      | api -X POST "$KC/admin/realms/bankid-mock/partialImport" --data-binary @- >/dev/null
    info "realm bankid-mock updated"
  fi
  # BankID never asks for an e-mail address; Keycloak's user profile would (test people have none).
  api "$KC/admin/realms/bankid-mock/authentication/required-actions/VERIFY_PROFILE" \
    | jq '.enabled = false | .defaultAction = false' \
    | api -X PUT "$KC/admin/realms/bankid-mock/authentication/required-actions/VERIFY_PROFILE" --data-binary @-
fi
