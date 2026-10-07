#!/usr/bin/env bash
# Tunnel mode (ADR-0034): sets Pangolin up without its setup pages. Idempotent:
#   1. creates the server admin with the setup token (first run only), then signs in as the admin,
#   2. creates the organisation and the laptop's site with our own site credentials,
#   3. applies the blueprint (deploy/pangolin/blueprint.json.tmpl): the public resources and the
#      VPN-only (private) resources, so they always match this repository.
# It talks to Pangolin's dashboard API on the tunnel network, as the admin.
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="pangolin-init"
: "${RAADI_DOMAIN:?}" "${PANGOLIN_ADMIN_EMAIL:?}" "${TUNNEL_GATEWAY_IP:?}"
ORG="${PANGOLIN_ORG:-raadi}"
SITE="laptop"
API=http://pangolin:3000/api/v1

setup_token="$(secret pangolin_setup_token | cut -c1-32)"
site_secret="$(secret pangolin_site_secret)"
admin_password="$(secret pangolin_admin_password)"
session=""

# call <method> <path> [json] — the response body; fails (with a warning on stderr) on a non-2xx answer.
call() {
  local out code cookie=()
  out="$(mktemp)"
  [[ -n "$session" ]] && cookie=(-b "p_session_token=${session}")
  code="$(curl -sS -o "$out" -D "${out}.h" -w '%{http_code}' --max-time 30 -X "$1" "${API}$2" "${cookie[@]}" \
    -H 'X-CSRF-Token: x-csrf-protection' -H 'Content-Type: application/json' ${3:+--data "$3"})" \
    || { rm -f "$out" "${out}.h"; return 1; }
  # The session cookie is marked Secure, so curl would not send it back over this plain connection.
  local set
  set="$(sed -n 's/^[Ss]et-[Cc]ookie: p_session_token=\([^;]*\).*/\1/p' "${out}.h" | tr -d '\r')"
  [[ -n "$set" ]] && session="$set"
  rm -f "${out}.h"
  if [[ "$code" =~ ^2 ]]; then cat "$out"; rm -f "$out"; return 0; fi
  warn "$1 $2 answered ${code}: $(head -c 300 "$out")" >&2; rm -f "$out"; return 1
}

retry 30 curl -sf -o /dev/null --max-time 5 http://pangolin:3001/api/v1/ || die "Pangolin's API did not come up"

if [[ "$(call GET /auth/initial-setup-complete | jq -r '.data.complete')" != true ]]; then
  body="$(jq -cn --arg e "$PANGOLIN_ADMIN_EMAIL" --arg p "$admin_password" --arg t "$setup_token" \
    '{email: $e, password: $p, setupToken: $t}')"
  call PUT /auth/set-server-admin "$body" >/dev/null || die "could not create the Pangolin admin"
  info "created the Pangolin admin ${PANGOLIN_ADMIN_EMAIL}"
fi

# Not in $(…): call keeps the session cookie in this shell.
login="$(mktemp)"
call POST /auth/login "$(jq -cn --arg e "$PANGOLIN_ADMIN_EMAIL" --arg p "$admin_password" '{email: $e, password: $p}')" \
  > "$login" || die "could not sign in to Pangolin as ${PANGOLIN_ADMIN_EMAIL} (password changed? ./raadi secret-set pangolin_admin_password)"
if jq -e '.data.codeRequested or .data.twoFactorSetupRequired' "$login" >/dev/null; then
  # Two-factor sign-in cannot be scripted. The resources keep what was applied last.
  warn "the Pangolin admin uses two-factor sign-in: the blueprint was not applied this time"
  exit 0
fi

orgs="$(call GET "/orgs?limit=1000")" || die "could not list the organisations"
if ! jq -e --arg o "$ORG" '[.data.orgs[]?.orgId] | index($o)' <<<"$orgs" >/dev/null; then
  call PUT /org "$(jq -cn --arg o "$ORG" \
    '{orgId: $o, name: "Raadiso", subnet: "100.90.128.0/24", utilitySubnet: "100.96.128.0/24"}')" >/dev/null \
    || die "could not create the organisation ${ORG}"
  info "created the organisation ${ORG}"
fi

sites="$(call GET "/org/${ORG}/sites?pageSize=100")" || die "could not list the sites"
if ! jq -e --arg s "$SITE" '[.data.sites[]?.niceId] | index($s)' <<<"$sites" >/dev/null; then
  address="$(call GET "/org/${ORG}/pick-site-defaults" | jq -r '.data.clientAddress // empty')"
  body="$(jq -cn --arg n "$SITE" --arg id "${site_secret:0:15}" --arg s "${site_secret:15}" --arg a "$address" \
    '{name: "Laptop", niceId: $n, type: "newt", newtId: $id, secret: $s} + (if $a == "" then {} else {address: $a} end)')"
  call PUT "/org/${ORG}/site" "$body" >/dev/null || die "could not create the site ${SITE}"
  info "created the site ${SITE}"
fi

# JSON is YAML, which is what this endpoint takes.
export RAADI_DOMAIN PANGOLIN_ADMIN_EMAIL TUNNEL_GATEWAY_IP
# shellcheck disable=SC2016 # envsubst's list of variables, not an expansion
blueprint="$(envsubst '${RAADI_DOMAIN} ${PANGOLIN_ADMIN_EMAIL} ${TUNNEL_GATEWAY_IP}' \
  < /opt/raadi/templates/pangolin/blueprint.json.tmpl | jq -c .)"
call PUT "/org/${ORG}/blueprint" "$(jq -cn --arg b "$blueprint" '{name: "raadi", blueprint: $b, source: "API"}')" \
  >/dev/null || die "Pangolin refused the blueprint"
info "applied the blueprint: public ${RAADI_DOMAIN}, auth.${RAADI_DOMAIN} and pay.${RAADI_DOMAIN}; VPN ${RAADI_DOMAIN} and *.${RAADI_DOMAIN}"
