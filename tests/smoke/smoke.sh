#!/usr/bin/env bash
# Raadi smoke test — runs against the full compose stack, through the gateway,
# exactly like a browser would (Host-based routing via --connect-to).
#   ./raadi smoke      or      docker compose --profile test run --rm smoke
set -uo pipefail

# The gateway inside the network: port 443 when the public URLs are https (phone mode, production).
GW="${GATEWAY_INTERNAL:-traefik:$([[ "${PUBLIC_SCHEME:-http}" == https ]] && echo 443 || echo 80)}"
PUBLIC="${PUBLIC_BASE_URL:?}"
ADMIN="${ADMIN_BASE_URL:?}"
AUTH="${AUTH_BASE_URL:?}"
GRAFANA="${GRAFANA_BASE_URL:?}"
REALM="${KEYCLOAK_REALM:-raadi}"
USER_EMAIL="kari.nordmann@${DEMO_EMAIL_DOMAIN:-${RAADI_DOMAIN:?}}"
PASSWORD="${DEMO_USER_PASSWORD:?demo users are required for the smoke test}"
ORIGIN="$(sed -E 's#^(https?://[^/]+).*#\1#' <<<"$PUBLIC")"

JAR="$(mktemp)"; BODY="$(mktemp)"; HDRS="$(mktemp)"
trap 'rm -f "$JAR" "$BODY" "$HDRS"' EXIT
passed=0; failed=0

ok()   { passed=$((passed + 1)); printf '  \033[32m✔\033[0m %s\n' "$1"; }
fail() { failed=$((failed + 1)); printf '  \033[31m✘\033[0m %s\n' "$1"; [[ -n "${2:-}" ]] && printf '      %s\n' "$2"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# req <method> <url> [curl args...] — sets $status, body in $BODY, headers in $HDRS
req() {
  local method="$1" url="$2"; shift 2
  status=$(curl -s -o "$BODY" -D "$HDRS" -w '%{http_code}' --max-time 15 \
    --connect-to "::${GW}" -b "$JAR" -c "$JAR" -X "$method" "$@" "$url")
  # Browsers treat http://*.localhost as a secure context and accept "Secure"
  # cookies there (Keycloak's are always Secure); curl refuses them over plain
  # HTTP, so store them in the jar ourselves, like a browser would.
  if [[ "$url" =~ ^http://([^/:]+\.)?localhost[:/] ]]; then
    local host; host="$(sed -E 's#^http://([^/:]+).*#\1#' <<<"$url")"
    grep -i '^set-cookie:.*;\s*secure' "$HDRS" | tr -d '\r' | while IFS= read -r line; do
      local pair="${line#*: }"; pair="${pair%%;*}"
      local path; path="$(grep -oiE ';\s*path=[^;]*' <<<"$line" | head -1 | sed -E 's/;\s*[Pp]ath=//')"
      printf '%s\tFALSE\t%s\tFALSE\t0\t%s\t%s\n' "$host" "${path:-/}" "${pair%%=*}" "${pair#*=}" >> "$JAR"
    done
  fi
}
header() { grep -i "^$1:" "$HDRS" | head -1 | cut -d' ' -f2- | tr -d '\r'; }
# login_as <email> — full Authorization Code + PKCE login through the gateway,
# starting from a fresh cookie jar. Returns non-zero on any failed step.
login_as() { # <email> [base URL: the website, or the admin console's host]
  local base="${2:-$PUBLIC}"
  : > "$JAR"
  # The BFFs allow 20 sign-ins a minute per address; smoke signs in often, so wait out a 429.
  for _ in 1 2 3 4 5 6; do
    req GET "$base/auth/login?returnTo=/en&locale=en"
    [[ "$status" == 429 ]] || break
    sleep "$(header retry-after | grep -E '^[0-9]+$' || echo 10)"
  done
  local loc; loc="$(header location)"
  req GET "$loc"
  local action; action=$(grep -o '<form[^>]*id="kc-form-login"[^>]*>' "$BODY" | grep -o 'action="[^"]*"' | head -1 \
    | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
  [[ -n "$action" ]] || return 1
  req POST "$action" --data-urlencode "username=$1" --data-urlencode "password=$PASSWORD" --data-urlencode "credentialId="
  # Staff are asked for a one-time code after the password (ADR-0028). Keycloak accepts each code
  # once, so a code already used in this 30 s window is retried with the next window's code.
  local otp_action try
  for try in 1 2; do
    otp_action=$(grep -o '<form[^>]*id="kc-otp-login-form"[^>]*>' "$BODY" | grep -o 'action="[^"]*"' | head -1 \
      | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
    [[ -n "$otp_action" ]] || break
    (( try == 1 )) || sleep $(( 31 - $(date +%s) % 30 ))
    req POST "$otp_action" --data-urlencode "otp=$(totp)"
  done
  local cb; cb="$(header location)"
  [[ "$cb" == "$base/auth/callback?"* ]] || return 1
  req GET "$cb"
  [[ "$status" == "302" ]]
}
json() { jq -r "$1" "$BODY" 2>/dev/null; }
# totp — the demo staff users' current one-time code (RFC 6238: HMAC-SHA256, 6 digits, 30 s; the key
# is DEMO_OTP_SECRET's bytes, as Keycloak stores it).
totp() {
  local c=$(( $(date +%s) / 30 )) bytes="" i
  for i in 7 6 5 4 3 2 1 0; do bytes+=$(printf '\\x%02x' $(( (c >> (i * 8)) & 255 ))); done
  local mac; mac=$(printf '%b' "$bytes" | openssl dgst -sha256 -mac HMAC -macopt "key:${DEMO_OTP_SECRET:?}" -r | cut -d' ' -f1)
  local off=$(( 16#${mac:63:1} ))
  printf '%06d' $(( ((16#${mac:$((off * 2)):8}) & 0x7fffffff) % 1000000 ))
}
expect_status() { [[ "$status" == "$1" ]] && ok "$2" || fail "$2" "expected HTTP $1, got $status: $(head -c 400 "$BODY")"; }
q() { curl -sf --max-time 10 --get --data-urlencode "query=$1" http://prometheus:9090/api/v1/query | jq -e "$2"; }
# token_from <bff> <cookie name>: the bearer token the BFF hands out for the jar's session cookie.
token_from() {
  local sid; sid="$(awk -v n="$2" '$6 == n { v = $7 } END { print v }' "$JAR")"
  curl -s -D - -o /dev/null --max-time 10 -H "cookie: $2=$sid" -H 'x-forwarded-method: GET' \
    "http://$1:4000/auth/forward" | tr -d '\r' | sed -n 's/^[Aa]uthorization: Bearer //p'
}
staff_api() { # <token> <method> <url> [body]: prints the HTTP status, body in $BODY
  local body=()
  [[ -n "${4:-}" ]] && body=(-H 'content-type: application/json' --data "$4")
  curl -s -o "$BODY" -w '%{http_code}' --max-time 15 -X "$2" -H "authorization: Bearer $1" \
    "${body[@]}" "$3"
}
# console_token <email>: signs in to the admin console (with the one-time code) and prints its token.
# Staff actions use the staff APIs with such a token (ADR-0030); a website session never acts as staff.
console_token() {
  login_as "$1" "$ADMIN" || return 1
  token_from admin-bff raadi_admin_sid
}
eventually() { # <description> <seconds> <command...>
  local desc="$1" secs="$2"; shift 2
  local end=$((SECONDS + secs))
  until "$@" >/dev/null 2>&1; do
    (( SECONDS >= end )) && { fail "$desc" "not true after ${secs}s"; return; }
    sleep 3
  done
  ok "$desc"
}

section "Gateway & web"
req GET "$PUBLIC/"
[[ "$status" =~ ^(200|307|308)$ ]] && ok "web answers on $PUBLIC/" || fail "web answers on $PUBLIC/" "HTTP $status"
req GET "$PUBLIC/en"
expect_status 200 "localized home page renders (/en)"
grep -q 'Raadi' "$BODY" && ok "home page contains the brand" || fail "home page contains the brand"
[[ "$(header x-content-type-options)" == "nosniff" ]] && ok "X-Content-Type-Options: nosniff" || fail "X-Content-Type-Options header"
[[ "$(header x-frame-options)" == "DENY" ]] && ok "X-Frame-Options: DENY" || fail "X-Frame-Options header"
[[ -n "$(header content-security-policy)" ]] && ok "Content-Security-Policy present" || fail "Content-Security-Policy header"
[[ -z "$(header x-powered-by)" ]] && ok "no X-Powered-By leak" || fail "X-Powered-By leaked"
req GET "$PUBLIC/api/health"
expect_status 200 "web health endpoint"
req GET "$PUBLIC/auth/forward"
expect_status 404 "token-handler endpoint is not publicly routable"

section "Mobile app, web build (/m, ADR-0021)"
req GET "$PUBLIC/m/"
expect_status 200 "app shell renders (/m/)"
[[ "$(header content-security-policy)" == *"script-src 'self';"* ]] && ok "app has its own strict CSP" \
  || fail "app CSP" "got: $(header content-security-policy)"
bundle=$(grep -oE '/m/_expo/static/js/web/[^"]+\.js' "$BODY" | head -1)
if [[ -n "$bundle" ]]; then
  req GET "$PUBLIC$bundle"
  [[ "$status" == 200 && "$(header content-type)" == *javascript* ]] && ok "app bundle is served ($bundle)" \
    || fail "app bundle" "HTTP $status, $(header content-type)"
else
  fail "app shell references its bundle"
fi
req GET "$PUBLIC/m/my-listings"
expect_status 200 "client routes are served by the app (/m/my-listings)"

section "Mobile app, native sign-in (raadi-mobile, ADR-0021)"
# What the app does in Expo Go: OIDC + PKCE with an exp:// redirect, then the API with its own bearer
# token and no browser session, and a refresh of its offline token.
: > "$JAR"
verifier="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')"
challenge="$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
app_redirect='exp://127.0.0.1:8081/--/auth'
OIDC="$AUTH/realms/$REALM/protocol/openid-connect"
req GET "$OIDC/auth" -G --data-urlencode client_id=raadi-mobile --data-urlencode "redirect_uri=$app_redirect" \
  --data-urlencode response_type=code --data-urlencode 'scope=openid profile email offline_access' \
  --data-urlencode "code_challenge=$challenge" --data-urlencode code_challenge_method=S256 --data-urlencode state=smoke
action=$(grep -o '<form[^>]*id="kc-form-login"[^>]*>' "$BODY" | grep -o 'action="[^"]*"' | head -1 \
  | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
req POST "$action" --data-urlencode "username=$USER_EMAIL" --data-urlencode "password=$PASSWORD" --data-urlencode "credentialId="
code="$(header location | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"
[[ "$(header location)" == "$app_redirect?"* && -n "$code" ]] && ok "login returns to the app (exp:// redirect)" \
  || fail "native login redirect" "got: $(header location)"
req POST "$OIDC/token" --data-urlencode grant_type=authorization_code --data-urlencode client_id=raadi-mobile \
  --data-urlencode "code=$code" --data-urlencode "redirect_uri=$app_redirect" --data-urlencode "code_verifier=$verifier"
app_access="$(json .access_token)"; app_refresh="$(json .refresh_token)"
[[ "$status" == 200 && -n "$app_refresh" && "$(json .scope)" == *offline_access* ]] \
  && ok "PKCE code exchange gives an offline refresh token" || fail "native token exchange" "HTTP $status: $(head -c 300 "$BODY")"
: > "$JAR"
req GET "$PUBLIC/api/v1/listings/mine?limit=1" -H "Authorization: Bearer $app_access"
expect_status 200 "the app's bearer token passes the gateway (no browser session)"
req POST "$OIDC/token" --data-urlencode grant_type=refresh_token --data-urlencode client_id=raadi-mobile \
  --data-urlencode "refresh_token=$app_refresh"
expect_status 200 "the app's refresh token is accepted"
unset app_access app_refresh verifier challenge code

section "Identity provider"
req GET "$AUTH/realms/$REALM/.well-known/openid-configuration"
expect_status 200 "OIDC discovery"
issuer=$(jq -r .issuer "$BODY" 2>/dev/null)
[[ "$issuer" == "$AUTH/realms/$REALM" ]] && ok "issuer is $issuer" || fail "issuer" "got '$issuer'"
req GET "$AUTH/metrics"
[[ "$status" == "404" ]] && ok "Keycloak metrics not exposed publicly" || fail "Keycloak metrics exposed" "HTTP $status"
# Keycloak frames its own pages (admin console, keycloak-js cookie check); DENY left the console blank.
req GET "$OIDC/3p-cookies/step1.html"
[[ "$(header x-frame-options)" == SAMEORIGIN ]] && ok "Keycloak may frame its own pages (admin console loads)" || fail "Keycloak framing" "X-Frame-Options: $(header x-frame-options)"
req GET "$PUBLIC/en"
[[ "$(header x-frame-options)" == DENY ]] && ok "the website cannot be framed" || fail "website framing" "X-Frame-Options: $(header x-frame-options)"

section "Sign-up (hosted registration, Raadi theme)"
: > "$JAR"
req GET "$PUBLIC/auth/login?signup=1&returnTo=/en&locale=en"
signup_url="$(header location)"
[[ "$status" == "302" && "$signup_url" == *prompt=create* ]] && ok "sign-up opens Keycloak's registration (prompt=create)" || fail "sign-up redirect" "HTTP $status $signup_url"
page=$(curl -s --max-time 10 --connect-to "::${GW}" -b "$JAR" -c "$JAR" -L "$signup_url")
grep -q 'kc-register-form' <<<"$page" && grep -q 'raadi-wordmark' <<<"$page" \
  && ok "registration page uses the Raadi theme" || fail "registration page"
! grep -q 'id="password"' <<<"$page" && ok "password is set after the e-mail is confirmed (no pre-hijacking)" || fail "password on registration form"
req GET "$PUBLIC/en/terms"
expect_status 200 "terms of use page"
req GET "$PUBLIC/nb/bil"
expect_status 200 "category page (/nb/bil)"
grep -q 'data-testid="subcategory-personbil"' "$BODY" && ok "category page shows subcategory tiles" || fail "subcategory tiles"
req GET "$PUBLIC/nb/baater"
expect_status 404 "unknown category is a 404"

section "Login flow (Authorization Code + PKCE via identity-bff)"
req GET "$PUBLIC/api/v1/identity/me"
expect_status 401 "API rejects anonymous requests"
[[ "$(header content-type)" == application/problem+json* ]] && ok "errors are RFC 9457 problem+json" || fail "problem+json content type"

# Login CSRF: someone signs in, stops at the callback and sends the link to a victim, whose browser
# would end up in the attacker's account. The callback only works in the browser that started it.
: > "$JAR"
req GET "$PUBLIC/auth/login?returnTo=/en&locale=en"
grep -qi '^set-cookie: raadi_sid_login_[0-9a-f]*=.*HttpOnly' "$HDRS" && ok "login binds the transaction to this browser (HttpOnly cookie)" \
  || fail "login binding cookie"
req GET "$(header location)"
action=$(grep -o '<form[^>]*id="kc-form-login"[^>]*>' "$BODY" | grep -o 'action="[^"]*"' | head -1 | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
req POST "$action" --data-urlencode "username=$USER_EMAIL" --data-urlencode "password=$PASSWORD" --data-urlencode "credentialId="
attacker_cb="$(header location)"
: > "$JAR"
req GET "$attacker_cb"
[[ "$status" == "302" && "$(header location)" == *"authError=expired"* ]] && ! grep -qi '^set-cookie: raadi_sid=' "$HDRS" \
  && ok "a sign-in callback from another browser is refused (login CSRF)" || fail "login CSRF" "HTTP $status → $(header location)"
: > "$JAR"

req GET "$PUBLIC/auth/login?returnTo=/en/account&locale=en"
loc="$(header location)"
[[ "$status" == "302" && "$loc" == "$AUTH/realms/$REALM/protocol/openid-connect/auth?"* ]] \
  && ok "login redirects to Keycloak" || fail "login redirects to Keycloak" "HTTP $status → $loc"
[[ "$loc" == *"code_challenge_method=S256"* ]] && ok "PKCE (S256) is used" || fail "PKCE missing"

req GET "$loc"
action=$(grep -o '<form[^>]*id="kc-form-login"[^>]*>' "$BODY" | grep -o 'action="[^"]*"' | head -1 | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
[[ -n "$action" ]] && ok "Keycloak login form rendered" || fail "Keycloak login form rendered" "HTTP $status"

req POST "$action" --data-urlencode "username=$USER_EMAIL" --data-urlencode "password=$PASSWORD" --data-urlencode "credentialId="
cb="$(header location)"
[[ "$status" == "302" && "$cb" == "$PUBLIC/auth/callback?"* ]] && ok "credentials accepted, redirected to callback" \
  || fail "credentials accepted" "HTTP $status → $cb"

req GET "$cb"
# A user's very first login goes through the welcome page, which keeps the original target.
case "$status $(header location)" in
  "302 /en/account") ok "callback returns to /en/account" ;;
  "302 /en/welcome?next=%2Fen%2Faccount") ok "first login goes to the welcome page, then /en/account" ;;
  *) fail "callback redirect" "HTTP $status → $(header location)" ;;
esac
grep -qi '^set-cookie: raadi_sid=.*HttpOnly' "$HDRS" && ok "session cookie is HttpOnly" || fail "HttpOnly session cookie"
grep -qi '^set-cookie: raadi_sid=.*SameSite=Lax' "$HDRS" && ok "session cookie is SameSite=Lax" || fail "SameSite session cookie"

req GET "$PUBLIC/auth/session"
[[ "$(jq -r .user.email "$BODY" 2>/dev/null)" == "$USER_EMAIL" ]] && ok "session reports the signed-in user" || fail "session user" "$(cat "$BODY")"
grep -q 'eyJ' "$BODY" && fail "session endpoint leaks a token" || ok "no tokens exposed to the browser"

req GET "$PUBLIC/api/v1/identity/me"
expect_status 200 "API call authorised via session (token-handler)"
[[ "$(jq -r .email "$BODY" 2>/dev/null)" == "$USER_EMAIL" ]] && ok "/me returns the profile" || fail "/me profile" "$(cat "$BODY")"
jq -e '.roles | index("user")' "$BODY" >/dev/null 2>&1 && ok "/me includes realm roles" || fail "/me roles"
[[ "$(header cache-control)" == "no-store" ]] && ok "personal API answers are never cached (Cache-Control: no-store)" \
  || fail "cache-control on /me" "$(header cache-control)"

req PATCH "$PUBLIC/api/v1/identity/me" -H 'content-type: application/json' -H 'origin: https://evil.example' --data '{"locale":"en"}'
expect_status 403 "cross-site state change is rejected (CSRF)"
req PATCH "$PUBLIC/api/v1/identity/me" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"locale":"so"}'
expect_status 200 "same-origin profile update succeeds"
req PATCH "$PUBLIC/api/v1/identity/me" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"locale":"xx","isAdmin":true}'
expect_status 400 "invalid input is rejected by validation"
req PATCH "$PUBLIC/api/v1/identity/me" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"locale":"nb"}'

req GET "$PUBLIC/en/account"
expect_status 200 "account page renders for the signed-in user"
grep -q "$USER_EMAIL" "$BODY" && ok "account page shows the user's e-mail" || fail "account page content"

req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"
[[ "$status" == "303" && "$(header location)" == "$AUTH/realms/$REALM/protocol/openid-connect/logout?"* ]] \
  && ok "logout ends the Keycloak session (RP-initiated logout)" || fail "logout" "HTTP $status → $(header location)"
req GET "$PUBLIC/auth/session"
[[ "$(jq -r .authenticated "$BODY" 2>/dev/null)" == "false" ]] && ok "session is gone after logout" || fail "session after logout"

section "Event backbone (Kafka, Debezium, Apicurio)"
connectors=$(curl -sf --max-time 10 http://kafka-connect:8083/connectors?expand=status \
  | jq '[.[] | select(.status.connector.state == "RUNNING" and all(.status.tasks[]; .state == "RUNNING"))] | length' 2>/dev/null)
[[ "$connectors" -ge 3 ]] && ok "Debezium outbox connectors running ($connectors)" || fail "Debezium connectors" "running: $connectors"
artifacts=$(curl -sf --max-time 10 'http://apicurio:8080/apis/registry/v3/groups/no.raadi.events/artifacts?limit=100' | jq '.count' 2>/dev/null)
[[ "$artifacts" -ge 8 ]] && ok "event schemas registered in Apicurio ($artifacts)" || fail "Apicurio artifacts" "count: $artifacts"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
  http://apicurio:8080/apis/registry/v3/groups -d '{"groupId":"smoke"}')
[[ "$code" == "401" || "$code" == "403" ]] && ok "schema registry refuses anonymous writes" || fail "registry anonymous write" "HTTP $code"

section "Search (OpenSearch via Kafka)"
eventually "all demo listings are searchable" 180 \
  bash -c "curl -sf --connect-to ::$GW '$PUBLIC/api/v1/search/listings?pageSize=1' | jq -e '.total >= 500'"
req GET "$PUBLIC/api/v1/search/listings?category=bil&pageSize=5"
expect_status 200 "faceted search answers"
[[ "$(json '[.items[].category] | unique | join(",")')" == "bil" ]] && ok "category filter applies" || fail "category filter"
[[ "$(json '.facets.category | length')" -gt 1 ]] && ok "facets keep counts for other categories" || fail "facet counts"
req GET "$PUBLIC/api/v1/search/listings?near=bergen&radiusKm=100&sort=distance&pageSize=48"
json '.items | length > 0 and all(.[]; .distanceKm <= 100)' | grep -q true \
  && ok "geo radius search (100 km around Bergen) with distances" || fail "geo radius search" "$(head -c 300 "$BODY")"
req GET "$PUBLIC/api/v1/search/listings?q=langrennski"
[[ "$(json '.total')" -gt 0 ]] && ok "full-text search tolerates typos (langrennski)" || fail "fuzzy search"
req GET "$PUBLIC/api/v1/search/listings?category=bil&yearMin=2018&mileageMax=150000&pageSize=48"
json '.items | all(.[]; .attributes.year >= 2018 and .attributes.mileageKm <= 150000)' | grep -q true \
  && ok "range filters (year, mileage) apply" || fail "range filters" "$(head -c 300 "$BODY")"
[[ "$(json '.facets.make | length')" -gt 0 ]] && ok "car makes are counted as a facet" || fail "make facet"
req GET "$PUBLIC/api/v1/search/listings?yearMin=2020&yearMax=2010"
expect_status 400 "inverted ranges are rejected"
req GET "$PUBLIC/api/v1/search/listings?category=boats"
expect_status 400 "invalid search parameters are rejected"
req GET "$PUBLIC/api/v1/search/suggest?q=Lan"
[[ "$(json '.suggestions | length')" -gt 0 ]] && ok "search-as-you-type suggestions" || fail "suggestions"

section "Listings, media and authorization"
# Images are optional, so take the newest listing that has one.
req GET "$PUBLIC/api/v1/search/listings?pageSize=24&sort=newest"
seeded="$(json '[.items[] | select(.image)][0].id')"; card="$(json '[.items[] | select(.image)][0].image.card')"
req GET "$PUBLIC/api/v1/listings/$seeded"
expect_status 200 "public listing detail"
[[ -n "$(header etag)" ]] && ok "listing has an ETag (optimistic concurrency)" || fail "ETag header"
req GET "$PUBLIC$card"
[[ "$status" == "200" && "$(header content-type)" == image/webp* ]] && ok "listing image served by imgproxy (WebP)" || fail "listing image" "HTTP $status"
req GET "$PUBLIC${card/pr:card/pr:large}"
expect_status 403 "imgproxy refuses tampered URLs (signature)"
req POST "$PUBLIC/api/v1/listings" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{}'
expect_status 401 "anonymous users cannot create listings"

login_as "$USER_EMAIL" && ok "logged in as $USER_EMAIL" || fail "login as $USER_EMAIL"
req POST "$PUBLIC/api/v1/media" -H "origin: $ORIGIN" -F "file=@/opt/raadi/fixtures/images/listing.jpg;type=image/jpeg"
expect_status 201 "image upload accepted (scanned, re-encoded)"
image="$(json '.id')"
[[ "$(json '.contentType')" == "image/jpeg" && "$(json '.width')" == "800" ]] && ok "stored image is a sanitized JPEG" || fail "stored image" "$(cat "$BODY")"
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > /tmp/not-an-image.jpg
req POST "$PUBLIC/api/v1/media" -H "origin: $ORIGIN" -F "file=@/tmp/not-an-image.jpg;type=image/jpeg"
[[ "$status" == "422" && "$(json '.errors[0].code')" == "unsupported_type" ]] \
  && ok "non-images are refused by content sniffing" || fail "content sniffing" "HTTP $status $(cat "$BODY")"
# Phone photos are several MB: the gateway buffers bodies over 1 MB in /tmp (a 500 when it could not).
{ printf '\xff\xd8\xff\xe0'; head -c 3000000 /dev/urandom; } > /tmp/large.jpg
req POST "$PUBLIC/api/v1/media" -H "origin: $ORIGIN" -F "file=@/tmp/large.jpg;type=image/jpeg"
[[ "$status" == "422" ]] && ok "a 3 MB upload passes the gateway to the media service" || fail "large upload" "HTTP $status $(head -c 200 "$BODY")"
# ClamAV's EICAR signature is anchored at offset 0, so the file is sent as is
# (every upload is scanned before its type is checked).
# shellcheck disable=SC2016 # the "$" characters are part of the EICAR string
printf 'X5O!P%%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > /tmp/eicar.jpg
req POST "$PUBLIC/api/v1/media" -H "origin: $ORIGIN" -F "file=@/tmp/eicar.jpg;type=image/jpeg"
[[ "$status" == "422" && "$(json '.errors[0].code')" == "malware" ]] && ok "ClamAV rejects the EICAR test virus" || fail "malware scan" "HTTP $status $(cat "$BODY")"

title="Smoke test $(date +%s%N | tail -c 7) Langrennsski"
listing_body() {
  jq -nc --arg t "$1" --arg img "$image" '{category: "torget", subcategory: "sport", title: $t,
    description: "Created by the smoke test.", priceNok: 1500, attributes: {condition: "good"},
    placeId: "tromso", imageIds: [$img]}'
}
req POST "$PUBLIC/api/v1/listings" -H 'content-type: application/json' -H 'origin: https://evil.example' --data "$(listing_body "$title")"
expect_status 403 "cross-site listing creation is rejected (CSRF)"
req POST "$PUBLIC/api/v1/listings" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(listing_body "$title")"
expect_status 201 "listing created with an uploaded image"
listing="$(json '.id')"
[[ "$(json '.viewer.isOwner')" == "true" ]] && ok "creator is the owner (OpenFGA)" || fail "owner tuple"
req POST "$PUBLIC/api/v1/listings" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  --data "$(listing_body "Selger våpen billig")"
[[ "$status" == "422" && "$(json '.errors[0].code')" == "prohibited_item" ]] && ok "OPA policy blocks prohibited items" || fail "OPA policy" "HTTP $status"
eventually "new listing reaches search via outbox -> Debezium -> Kafka" 90 \
  bash -c "curl -sf --connect-to ::$GW -G '$PUBLIC/api/v1/search/listings' --data-urlencode 'q=$title' | jq -e '.items[] | select(.id == \"$listing\")'"
req PATCH "$PUBLIC/api/v1/listings/$listing" -H 'content-type: application/json' -H "origin: $ORIGIN" -H 'if-match: "99"' --data '{"priceNok": 1200}'
expect_status 412 "stale If-Match is refused"
req PATCH "$PUBLIC/api/v1/listings/$listing" -H 'content-type: application/json' -H "origin: $ORIGIN" -H 'if-match: "1"' --data '{"priceNok": 1200}'
[[ "$status" == "200" && "$(json '.version')" == "2" ]] && ok "owner can edit (version 2)" || fail "owner edit" "HTTP $status"
req DELETE "$PUBLIC/api/v1/media/$image" -H "origin: $ORIGIN"
eventually "media learns the image is attached (listing events)" 60 \
  bash -c "curl -s -o /dev/null -w '%{http_code}' --connect-to ::$GW -b '$JAR' -X DELETE -H 'origin: $ORIGIN' '$PUBLIC/api/v1/media/$image' | grep -q 409"

login_as "ola.nordmann@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as ola"
req PATCH "$PUBLIC/api/v1/listings/$listing" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"priceNok": 1}'
expect_status 403 "another user cannot edit the listing (OpenFGA)"
req POST "$PUBLIC/api/v1/listings" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(listing_body "Stolen image")"
[[ "$status" == "422" ]] && ok "another user cannot attach someone else's image" || fail "image ownership" "HTTP $status"

login_as "moderator@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as moderator"
req DELETE "$PUBLIC/api/v1/listings/$listing" -H "origin: $ORIGIN"
expect_status 403 "a moderator's website session cannot remove listings (staff act in the console)"
moderator_token="$(console_token "moderator@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}")" || fail "console login as moderator"
[[ "$(staff_api "$moderator_token" POST "http://listings:4000/admin/v1/listings/$listing/remove" '{"reasonCode":"fraud","note":"smoke"}')" =~ ^20[01]$ ]] \
  && ok "a moderator removes the listing in the console, with a reason" || fail "console removal" "$(head -c 200 "$BODY")"
eventually "removed listing disappears from search" 90 \
  bash -c "! curl -sf --connect-to ::$GW -G '$PUBLIC/api/v1/search/listings' --data-urlencode 'q=$title' | jq -e '.items[] | select(.id == \"$listing\")'"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Messaging (conversations, WebSocket, events)"
: > "$JAR"
req GET "$PUBLIC/api/v1/messaging/conversations"
expect_status 401 "anonymous users cannot read conversations"
ws() { # <origin> — WebSocket handshake through the gateway with the session cookie
  curl -s -o /dev/null -w '%{http_code}' --max-time 3 --http1.1 --connect-to "::${GW}" -b "$JAR" \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: $1" "$PUBLIC/api/v1/messaging/ws"
}
[[ "$(ws "$ORIGIN")" == "401" ]] && ok "anonymous WebSocket upgrades are refused" || fail "anonymous WebSocket"

login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req GET "$PUBLIC/api/v1/listings/mine?limit=1"
kari_listing="$(json '.items[0].id')"
# The seller's phone: an app installation registers its Expo push token (ADR-0025).
push_token="ExponentPushToken[smoke-$(date +%s%N | tail -c 9)]"
req PUT "$PUBLIC/api/v1/notifications/devices" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  --data '{"token":"not-a-push-token","platform":"ios"}'
expect_status 400 "malformed push tokens are rejected"
req PUT "$PUBLIC/api/v1/notifications/devices" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  --data "$(jq -nc --arg t "$push_token" '{token: $t, platform: "ios"}')"
expect_status 204 "the app registers its push token"
req GET "$PUBLIC/internal/v1/listings/$kari_listing/contact"
# The gateway sends the path to the web app (a locale redirect or 404), never to listings.
[[ "$status" =~ ^(307|404)$ ]] && ! grep -q ownerId "$BODY" \
  && ok "internal listings API is not reachable through the gateway" || fail "internal API exposed" "HTTP $status"

login_as "ola.nordmann@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as ola"
hello="Hei! Er denne fortsatt ledig? (smoke $(date +%s%N | tail -c 7))"
start() { jq -nc --arg l "$1" --arg b "$2" '{listingId: $l, body: $b}'; }
req POST "$PUBLIC/api/v1/messaging/conversations" -H 'content-type: application/json' \
  -H 'origin: https://evil.example' --data "$(start "$kari_listing" "$hello")"
expect_status 403 "cross-site message is rejected (CSRF)"
req POST "$PUBLIC/api/v1/messaging/conversations" -H 'content-type: application/json' \
  -H "origin: $ORIGIN" --data "$(start "$kari_listing" "$hello")"
[[ "$status" =~ ^20[01]$ && "$(json '.conversation.role')" == "buyer" && "$(json '.conversation.counterpart.name')" == "Kari N." ]] \
  && ok "buyer contacts the seller (HTTP $status)" || fail "start conversation" "HTTP $status $(head -c 300 "$BODY")"
conversation="$(json '.conversation.id')"
req POST "$PUBLIC/api/v1/messaging/conversations" -H 'content-type: application/json' \
  -H "origin: $ORIGIN" --data "$(start "$kari_listing" "En melding til")"
[[ "$status" == "200" && "$(json '.conversation.id')" == "$conversation" ]] \
  && ok "one conversation per listing and buyer" || fail "conversation reuse" "HTTP $status"
req GET "$PUBLIC/api/v1/listings/mine?limit=1"
req POST "$PUBLIC/api/v1/messaging/conversations" -H 'content-type: application/json' \
  -H "origin: $ORIGIN" --data "$(start "$(json '.items[0].id')" "Til meg selv")"
[[ "$status" == "422" && "$(json '.errors[0].code')" == "own_listing" ]] && ok "sellers cannot message themselves" || fail "own listing" "HTTP $status"
req POST "$PUBLIC/api/v1/messaging/conversations/$conversation/messages" -H 'content-type: application/json' \
  -H "origin: $ORIGIN" --data '{"body":"   "}'
expect_status 400 "empty messages are rejected"
[[ "$(ws "$ORIGIN")" == "101" ]] && ok "WebSocket opens for a signed-in user (via token handler)" || fail "WebSocket upgrade"
[[ "$(ws "https://evil.example")" == "403" ]] && ok "WebSocket refuses foreign origins" || fail "WebSocket origin check"

login_as "amina.hassan@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as amina"
req GET "$PUBLIC/api/v1/messaging/conversations/$conversation"
expect_status 404 "other users cannot read the conversation"

login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req GET "$PUBLIC/api/v1/messaging/conversations/$conversation"
[[ "$status" == "200" && "$(json '.role')" == "seller" ]] && json '.messages[].body' | grep -qF "$hello" \
  && ok "the seller reads the conversation" || fail "seller view" "HTTP $status"
req GET "$PUBLIC/api/v1/messaging/unread"
[[ "$(json '.count')" -ge 2 ]] && ok "unread count for the seller ($(json '.count'))" || fail "unread count"
req POST "$PUBLIC/api/v1/messaging/conversations/$conversation/read" -H "origin: $ORIGIN"
expect_status 204 "seller marks the conversation read"
req GET "$PUBLIC/api/v1/messaging/conversations"
[[ "$(jq -r --arg c "$conversation" '.items[] | select(.id == $c) | .unread' "$BODY")" == "0" ]] \
  && ok "inbox shows the conversation as read" || fail "inbox unread after read"
eventually "message events reach Kafka (outbox -> Debezium)" 120 \
  q 'sum(kafka_partition_current_offset_ratio{topic="raadi.conversation.events"})' '.data.result[0].value[1] | tonumber > 0'
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Notifications (e-mail, in-app, preferences)"
: > "$JAR"
req GET "$PUBLIC/api/v1/notifications"
expect_status 401 "anonymous users cannot read notifications"
mailpit() { curl -sf --max-time 10 --get --data-urlencode "query=$1" 'http://mailpit:8025/api/v1/search' | jq -e "$2"; }
eventually "new-message e-mail reaches the seller (queued, then sent)" 90 \
  mailpit "to:$USER_EMAIL subject:\"ny melding\"" '.messages_count > 0'
id=$(curl -sf --get --data-urlencode "query=to:$USER_EMAIL subject:\"ny melding\"" 'http://mailpit:8025/api/v1/search' | jq -r '.messages[0].ID')
text=$(curl -sf "http://mailpit:8025/api/v1/message/$id" | jq -r .Text)
grep -q "/nb/messages/" <<<"$text" && ! grep -qF "$hello" <<<"$text" \
  && ok "e-mail links to the conversation and contains no message text" || fail "e-mail content"
pushes() { curl -sf --max-time 10 --get --data-urlencode "to=$push_token" 'http://push-mock:4000/messages'; }
pushed() { pushes | jq -e --arg u "/messages/$conversation" 'any(.messages[]; .data.url == $u)'; }
eventually "new-message push reaches the seller's phone (Expo-compatible mock)" 90 pushed
# Other pushes can reach the same phone (a late listing-removed notice): pick this conversation's.
push=$(pushes | jq -c --arg u "/messages/$conversation" '[.messages[] | select(.data.url == $u)][0]')
[[ "$push" != "null" && "$(jq -r '.title' <<<"$push")" != "" ]] && ! grep -qF "$hello" <<<"$push" \
  && ok "push opens the conversation and contains no message text" || fail "push content" "$push"
[[ "$(jq -r '.categoryId' <<<"$push")" == "message" ]] \
  && ok "message pushes can be answered from the notification (category message)" || fail "push category" "$push"

login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
removed() { curl -sf --max-time 10 --connect-to "::${GW}" -b "$JAR" "$PUBLIC/api/v1/notifications" \
  | jq -e --arg t "$title" '.items[] | select(.kind == "listing_removed" and .params.title == $t)'; }
eventually "owner is notified when a moderator removes the listing" 90 removed
eventually "removal notice is e-mailed to the owner" 90 \
  mailpit "to:$USER_EMAIL subject:\"annonsen din er fjernet\"" '.messages_count > 0'
req POST "$PUBLIC/api/v1/notifications/read-all" -H "origin: $ORIGIN"
req GET "$PUBLIC/api/v1/notifications/unread"
[[ "$(json '.count')" == "0" ]] && ok "mark all read" || fail "mark all read" "$(cat "$BODY")"
req PUT "$PUBLIC/api/v1/notifications/preferences" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"emailMessages":"no"}'
expect_status 400 "invalid preferences are rejected"
req PUT "$PUBLIC/api/v1/notifications/preferences" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"emailMessages":false}'
[[ "$status" == "200" && "$(json '.emailMessages')" == "false" ]] && ok "message e-mails can be switched off" || fail "preferences"
req PUT "$PUBLIC/api/v1/notifications/preferences" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"emailMessages":true}'
[[ "$(json '.pushMessages')" == "true" ]] && ok "push preference is kept when an older client saves" || fail "push preference" "$(cat "$BODY")"
req DELETE "$PUBLIC/api/v1/notifications/devices/$(jq -rn --arg t "$push_token" '$t|@uri')" -H "origin: $ORIGIN"
expect_status 204 "signing out in the app removes its push token"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Favourites and saved searches (ADR-0026)"
: > "$JAR"
req GET "$PUBLIC/api/v1/saved/favourites"
expect_status 401 "anonymous users have no favourites"
OLA="ola.nordmann@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}"
word="smokefav$(date +%s%N | tail -c 8)"
login_as "$OLA" || fail "login as ola"
saved_search() { jq -nc --arg q "$word" '{name: ("Søk: " + $q), params: {q: $q, category: "torget", sort: "newest"}}'; }
req POST "$PUBLIC/api/v1/saved/searches" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(saved_search)"
[[ "$status" == "201" && "$(json '.params.sort // "none"')" == "none" ]] \
  && ok "a search is saved without its sorting" || fail "save search" "HTTP $status $(head -c 300 "$BODY")"
search_id="$(json '.id')"
req POST "$PUBLIC/api/v1/saved/searches" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(saved_search)"
[[ "$status" == "200" && "$(json '.id')" == "$search_id" ]] && ok "saving the same search again returns it" || fail "save search twice" "HTTP $status"
req POST "$PUBLIC/api/v1/saved/searches" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  --data '{"name":"x","params":{"category":"boats"}}'
expect_status 400 "saved searches are validated like the search API"

login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req POST "$PUBLIC/api/v1/listings" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  --data "$(jq -nc --arg t "$word racersykkel" '{category: "torget", subcategory: "sport", title: $t,
    description: "Created by the smoke test.", priceNok: 2000, attributes: {condition: "good"},
    placeId: "tromso", imageIds: []}')"
expect_status 201 "the seller publishes a listing that matches the saved search"
fav_listing="$(json '.id')"

login_as "$OLA" || fail "login as ola"
req PUT "$PUBLIC/api/v1/saved/favourites/$fav_listing" -H "origin: $ORIGIN"
expect_status 204 "a buyer adds the listing to favourites"
req GET "$PUBLIC/api/v1/saved/favourites/ids"
json '.ids' | grep -q "$fav_listing" && ok "the favourite shows up in the heart ids" || fail "favourite ids"
matched() { curl -sf --max-time 10 --connect-to "::${GW}" -b "$JAR" "$PUBLIC/api/v1/saved/searches" \
  | jq -e --arg id "$search_id" '.items[] | select(.id == $id and .newCount > 0)'; }
eventually "the saved search finds the new listing (matcher -> search)" 150 matched
notice() { curl -sf --max-time 10 --connect-to "::${GW}" -b "$JAR" "$PUBLIC/api/v1/notifications" \
  | jq -e --arg k "$1" --arg r "$2" '.items[] | select(.kind == $k and (.link | contains($r)))'; }
eventually "the buyer is told about new matches (alert event -> notifications)" 90 notice saved_search_match "$search_id"

login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req PATCH "$PUBLIC/api/v1/listings/$fav_listing" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"priceNok": 1500}'
expect_status 200 "the seller lowers the price"

login_as "$OLA" || fail "login as ola"
eventually "the buyer is told the favourite got cheaper" 90 notice favourite_price_drop "$fav_listing"
req GET "$PUBLIC/api/v1/saved/favourites"
[[ "$(jq -r --arg id "$fav_listing" '.items[] | select(.listingId == $id) | .listing.priceNok' "$BODY")" == "1500" ]] \
  && ok "the favourites list shows the new price" || fail "favourite price" "$(head -c 300 "$BODY")"
req DELETE "$PUBLIC/api/v1/saved/favourites/$fav_listing" -H "origin: $ORIGIN"
expect_status 204 "a favourite can be removed"
req DELETE "$PUBLIC/api/v1/saved/searches/$search_id" -H "origin: $ORIGIN"
expect_status 204 "a saved search can be deleted"
login_as "$USER_EMAIL" && req DELETE "$PUBLIC/api/v1/listings/$fav_listing" -H "origin: $ORIGIN"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Staff roles (admin and operator plan)"
staff_roles() { # <user> — the realm roles of a demo user's session ("," around each for matching)
  login_as "$1@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || return 1
  req GET "$PUBLIC/auth/session"
  echo ",$(json '.user.roles | sort | join(",")'),"
}
[[ "$(staff_roles support)" == *",support,"* ]] && ok "support has the support role" || fail "support role"
[[ "$(staff_roles operator)" == *",operator,"* ]] && ok "operator has the operator role" || fail "operator role"
admin_roles="$(staff_roles admin)"
[[ "$admin_roles" == *"moderator"* && "$admin_roles" == *"operator"* && "$admin_roles" == *"platform-admin"* && "$admin_roles" == *"support"* ]] \
  && ok "the platform admin holds every staff role" || fail "admin roles" "$admin_roles"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Reports and blocking (ADR-0027)"
: > "$JAR"
req POST "$PUBLIC/api/v1/listings/$kari_listing/reports" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"reason":"fraud"}'
expect_status 401 "anonymous users cannot report"
login_as "$OLA" || fail "login as ola"
req POST "$PUBLIC/api/v1/listings/$kari_listing/reports" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  --data '{"reason":"fraud","comment":"Ber om betaling på forhånd (smoke)"}'
expect_status 202 "a buyer reports a listing"
req GET "$PUBLIC/api/v1/listings/mine?limit=1"
req POST "$PUBLIC/api/v1/listings/$(json '.items[0].id')/reports" -H 'content-type: application/json' -H "origin: $ORIGIN" --data '{"reason":"other"}'
[[ "$status" == "422" && "$(json '.errors[0].code')" == "own_listing" ]] && ok "nobody reports their own listing" || fail "own report" "HTTP $status"
req GET "$PUBLIC/api/v1/listings/moderation/reports"
expect_status 404 "the website's API has no report queue (staff work it in the console)"
moderator_token="$(console_token "moderator@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}")" || fail "console login as moderator"
staff_api "$moderator_token" GET "http://listings:4000/admin/v1/listings/workbench" >/dev/null
jq -e --arg id "$kari_listing" '.items[] | select(.listing.id == $id and .reasons.fraud >= 1)' "$BODY" >/dev/null \
  && ok "the moderator sees the report, grouped by listing" || fail "report queue" "$(head -c 300 "$BODY")"
[[ "$(staff_api "$moderator_token" POST "http://listings:4000/admin/v1/listings/dismiss" "{\"ids\":[\"$kari_listing\"],\"note\":\"smoke\"}")" =~ ^20[01]$ ]] \
  && [[ "$(json '.closed')" -ge 1 ]] && ok "the moderator dismisses the reports" || fail "dismiss" "$(head -c 200 "$BODY")"
staff_api "$moderator_token" GET "http://listings:4000/admin/v1/listings/workbench" >/dev/null
! jq -e --arg id "$kari_listing" '.items[] | select(.listing.id == $id)' "$BODY" >/dev/null \
  && ok "dismissed reports leave the queue" || fail "queue after dismiss"

login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req PUT "$PUBLIC/api/v1/messaging/conversations/$conversation/block" -H "origin: $ORIGIN"
[[ "$status" == "200" && "$(json '.blockedByMe')" == "true" && "$(json '.canMessage')" == "false" ]] \
  && ok "the seller blocks the buyer" || fail "block" "HTTP $status $(head -c 200 "$BODY")"
login_as "$OLA" || fail "login as ola"
req POST "$PUBLIC/api/v1/messaging/conversations/$conversation/messages" -H 'content-type: application/json' \
  -H "origin: $ORIGIN" --data '{"body":"Hallo?"}'
[[ "$status" == "422" && "$(json '.errors[0].code')" == "conversation_closed" ]] \
  && ok "the blocked buyer cannot write" || fail "blocked send" "HTTP $status"
req GET "$PUBLIC/api/v1/messaging/conversations/$conversation"
[[ "$(json '.canMessage')" == "false" && "$(json '.blockedByMe')" == "false" ]] \
  && ok "the blocked buyer sees a closed conversation, not who closed it" || fail "blocked view"
login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req DELETE "$PUBLIC/api/v1/messaging/conversations/$conversation/block" -H "origin: $ORIGIN"
[[ "$status" == "200" && "$(json '.canMessage')" == "true" ]] && ok "the seller unblocks" || fail "unblock" "HTTP $status"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Reviews and trust (eligibility, BankID mock)"
: > "$JAR"
req GET "$PUBLIC/api/v1/trust/me"
expect_status 401 "anonymous users have no trust status"
req GET "$PUBLIC/api/v1/trust/users/00000000-0000-4000-8000-000000000000"
expect_status 404 "unknown profiles are 404"
req GET "$PUBLIC/api/v1/trust/verification/start?locale=en"
[[ "$status" == "302" && "$(header location)" == /auth/login* ]] \
  && ok "verification sends signed-out users to login first" || fail "verification start (anonymous)" "HTTP $status"
issuer=$(curl -sf --max-time 10 --connect-to "::${GW}" "$AUTH/realms/bankid-mock/.well-known/openid-configuration" | jq -r .issuer)
[[ "$issuer" == "$AUTH/realms/bankid-mock" ]] && ok "BankID mock provider is up" || fail "BankID mock discovery" "$issuer"

login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req GET "$PUBLIC/api/v1/trust/me"
[[ "$status" == "200" && "$(json '.name')" == "Kari N." ]] && ok "own trust status" || fail "trust/me" "HTTP $status"
kari_id="$(json '.userId')"
req GET "$PUBLIC/api/v1/trust/listings/$kari_listing/seller"
[[ "$status" == "200" && "$(json '.userId')" == "$kari_id" ]] \
  && ok "listing page can show the seller's rating (public)" || fail "seller summary" "HTTP $status"

login_as "ola.nordmann@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as ola"
req GET "$PUBLIC/api/v1/trust/eligibility?listingId=$kari_listing&subjectId=$kari_id"
# Ola wrote to Kari in the messaging section (Kari may have answered in an e2e run), but nothing was sold.
[[ "$(json '.canReview')" == "false" && "$(json '.reason')" =~ ^(no_conversation|not_sold)$ ]] \
  && ok "no review without a two-way conversation and a sale" || fail "eligibility" "$(head -c 300 "$BODY")"
review() { jq -nc --arg l "$kari_listing" --arg s "$kari_id" --argjson r "$1" '{listingId: $l, subjectId: $s, rating: $r}'; }
req POST "$PUBLIC/api/v1/trust/reviews" -H 'content-type: application/json' -H 'origin: https://evil.example' --data "$(review 5)"
expect_status 403 "cross-site review is rejected (CSRF)"
req POST "$PUBLIC/api/v1/trust/reviews" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(review 6)"
expect_status 400 "ratings outside 1-5 are rejected"
req POST "$PUBLIC/api/v1/trust/reviews" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(review 5)"
expect_status 422 "ineligible reviews are refused"
req GET "$PUBLIC/api/v1/trust/verification/start?locale=en&returnTo=//evil.example"
loc="$(header location)"
[[ "$status" == "302" && "$loc" == "$AUTH/realms/bankid-mock/protocol/openid-connect/auth?"* \
  && "$loc" == *code_challenge_method=S256* && "$loc" == *scope=openid\&* ]] \
  && ok "verification redirects to BankID (PKCE, openid only)" || fail "verification start" "HTTP $status $loc"
req GET "$PUBLIC/api/v1/trust/verification/callback?state=forged&code=x"
[[ "$status" == "302" && "$(header location)" == "/?verification=expired" ]] \
  && ok "forged verification callbacks are refused" || fail "verification callback" "HTTP $status $(header location)"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Payments (promoted listings, Vipps-compatible mock)"
: > "$JAR"
req GET "$PUBLIC/api/v1/payments/products"
[[ "$status" == "200" && "$(json '.items | length')" -ge 2 && "$(json '.items[0].currency')" == "NOK" ]] \
  && ok "prices are public (provider $(json '.provider'))" || fail "products" "HTTP $status"
order() { jq -nc --arg l "$1" --arg p "$2" '{listingId: $l, product: $p, locale: "en"}'; }
req POST "$PUBLIC/api/v1/payments/orders" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(order "$kari_listing" promote_7d)"
expect_status 401 "anonymous users cannot buy"
login_as "$USER_EMAIL" || fail "login as $USER_EMAIL"
req POST "$PUBLIC/api/v1/payments/orders" -H 'content-type: application/json' -H "origin: $ORIGIN" --data "$(order "$kari_listing" promote_7d)"
expect_status 400 "orders need an Idempotency-Key"
key="smoke-$(date +%s%N)"
req POST "$PUBLIC/api/v1/payments/orders" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -H "idempotency-key: $key" --data "$(order "$kari_listing" promote_7d)"
order_id="$(json '.id')"; pay_url="$(json '.redirectUrl')"
[[ "$status" == "201" && "$(json '.status')" == "created" && "$pay_url" == *"/pay/$order_id" ]] \
  && ok "order created; payer goes to the provider's page" || fail "create order" "HTTP $status $(head -c 300 "$BODY")"
req POST "$PUBLIC/api/v1/payments/orders" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -H "idempotency-key: $key" --data "$(order "$kari_listing" promote_7d)"
[[ "$status" == "200" && "$(json '.id')" == "$order_id" ]] && ok "a retried request returns the same order" || fail "idempotent replay" "HTTP $status"
approve=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 --connect-to "::${GW}" -X POST "$pay_url?action=approve")
[[ "$approve" == "303 $PUBLIC/en/payments/$order_id" ]] && ok "payer approves at the (mock) provider and returns" || fail "approve" "$approve"
captured() { curl -sf --max-time 10 --connect-to "::${GW}" -b "$JAR" "$PUBLIC/api/v1/payments/orders/$order_id" | jq -e '.status == "captured" and .promotedUntil != null'; }
eventually "signed webhook captures the order and activates the promotion" 60 captured
promoted() { curl -sf --max-time 10 --connect-to "::${GW}" "$PUBLIC/api/v1/listings/$kari_listing" | jq -e '.promotedUntil != null'; }
eventually "the promotion reaches the listing (payments -> Kafka -> listings)" 90 promoted
req POST "$PUBLIC/api/v1/payments/webhooks/vipps" -H 'content-type: application/json' --data '{"reference":"x","name":"CAPTURED"}'
expect_status 401 "unsigned webhooks are refused"
mock_api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --connect-to "::${GW}" "${pay_url%/pay/*}/epayment/v1/payments/$order_id")
[[ "$mock_api" == "404" ]] && ok "the mock provider's API is not exposed (only its payment page)" || fail "mock API exposed" "HTTP $mock_api"
req POST "$PUBLIC/api/v1/payments/orders/$order_id/refund" -H "origin: $ORIGIN"
expect_status 404 "the website's API cannot refund (staff refund in the console)"
login_as "admin@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as admin"
req POST "$PUBLIC/api/v1/payments/orders/$order_id/refund" -H "origin: $ORIGIN"
expect_status 404 "not even a platform admin's website session refunds"
admin_token="$(console_token "admin@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}")" || fail "console login as admin"
[[ "$(staff_api "$admin_token" POST "http://payments:4000/admin/v1/payments/orders/$order_id/refund" '{"reasonCode":"customer_request","note":"smoke"}')" == "200" ]] \
  && [[ "$(json '.status')" == "refunded" ]] && ok "a platform admin refunds the order in the console, with a reason" \
  || fail "refund" "$(head -c 200 "$BODY")"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Admin console host (ADR-0028)"
: > "$JAR"
req GET "$ADMIN/"
[[ "$status" =~ ^30[78]$ && "$(header location)" == */nb/admin ]] && ok "the admin host opens the console" || fail "admin root" "HTTP $status $(header location)"
req GET "$ADMIN/nb/admin"
[[ "$status" =~ ^30[278]$ && "$(header location)" == /auth/login* ]] && ok "the console asks anonymous visitors to sign in" || fail "admin anonymous" "HTTP $status $(header location)"
req GET "$ADMIN/nb/search"
[[ "$status" =~ ^30[78]$ && "$(header location)" == */nb/admin ]] && ok "the admin host serves only the console" || fail "admin host scope" "HTTP $status"
req GET "$PUBLIC/nb/admin"
expect_status 404 "the website has no admin pages"
req GET "$ADMIN/api/v1/listings/moderation/reports"
[[ "$status" != "200" ]] && ok "no API routes on the admin host" || fail "admin API exposed"
# The console asks for a one-time code after the password (Keycloak flow raadi-admin-browser).
: > "$JAR"
req GET "$ADMIN/auth/login?returnTo=/en/admin&locale=en"; req GET "$(header location)"
mfa_action=$(grep -o '<form[^>]*id="kc-form-login"[^>]*>' "$BODY" | grep -o 'action="[^"]*"' | head -1 | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
# smoke-target@ is a test-only account: a wrong code makes Keycloak lock the account for a minute
# (quick-login check), which must not hit the staff accounts the rest of the run signs in with.
req POST "$mfa_action" --data-urlencode "username=smoke-target@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" --data-urlencode "password=$PASSWORD" --data-urlencode "credentialId="
grep -q 'kc-otp-login-form' "$BODY" && ok "the console requires a one-time code (MFA)" || fail "admin MFA" "HTTP $status"
req POST "$(grep -o '<form[^>]*id="kc-otp-login-form"[^>]*>' "$BODY" | grep -o 'action="[^"]*"' | head -1 | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')" --data-urlencode "otp=000000"
grep -q 'kc-otp-login-form' "$BODY" && [[ "$(header location)" != *"/auth/callback"* ]] \
  && ok "a wrong one-time code is refused" || fail "wrong OTP accepted"
login_as "moderator@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" "$ADMIN" || fail "admin console login"
req GET "$ADMIN/auth/session"
[[ "$(json '.user.roles | index("moderator") != null')" == "true" ]] && ok "staff sign in to the console through admin-bff" || fail "admin session" "$(head -c 200 "$BODY")"
grep -q 'raadi_admin_sid' "$JAR" && ! grep -q $'\traadi_sid\t' "$JAR" \
  && ok "the console has its own session cookie" || fail "admin cookie"
req GET "$ADMIN/nb/admin/moderation"
expect_status 200 "a moderator opens the moderation queue in the console"
req GET "$ADMIN/nb/admin/audit"
expect_status 404 "a moderator cannot open the audit log"
login_as "kari.nordmann@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as kari"
req GET "$ADMIN/auth/session"
[[ "$(json '.authenticated')" == "false" ]] && ok "the website's session does not open the console" || fail "session leak"

section "Console staff APIs (ADR-0030)"
req GET "$PUBLIC/admin/v1/listings"
[[ "$status" != "200" ]] && ok "staff APIs are not routed by the gateway" || fail "staff API exposed" "HTTP $status"
login_as "admin@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as admin"
web_token="$(token_from identity-bff raadi_sid)"
[[ "$(staff_api "$web_token" GET http://listings:4000/admin/v1/listings)" == "403" ]] \
  && ok "a website token never opens staff APIs, even a platform admin's" || fail "website token accepted" "$(head -c 200 "$BODY")"
login_as "support@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" "$ADMIN" || fail "console login as support"
support_token="$(token_from admin-bff raadi_admin_sid)"
# Suspension and the other account actions use smoke-target@, a test-only account: if the run stops
# halfway, no demo user is left suspended.
[[ "$(staff_api "$support_token" GET "http://admin-bff:4000/admin/v1/users?q=smoke-target")" == "200" ]] \
  && [[ "$(json '.items[0].email')" == smoke-target@* ]] && ok "support finds an account through admin-bff (Keycloak service account)" \
  || fail "user search" "$(head -c 200 "$BODY")"
target="$(json '.items[0].id')"
[[ "$(staff_api "$support_token" GET http://listings:4000/admin/v1/listings/workbench)" == "403" ]] \
  && ok "support cannot work the moderation queue" || fail "support moderation" "HTTP $(head -c 100 "$BODY")"
[[ "$(staff_api "$support_token" POST "http://admin-bff:4000/admin/v1/users/$target/suspend" '{"reasonCode":"spam","note":"smoke"}')" == "204" ]] \
  && ok "support suspends an account (fresh sign-in passes step-up)" || fail "suspend" "$(head -c 200 "$BODY")"
staff_api "$support_token" GET "http://admin-bff:4000/admin/v1/users/$target" >/dev/null
[[ "$(json '.suspended')" == "true" && "$(json '.suspension.reasonCode')" == "spam" ]] \
  && ok "the account shows as suspended, with the reason" || fail "suspension state" "$(head -c 200 "$BODY")"
[[ "$(staff_api "$support_token" POST "http://admin-bff:4000/admin/v1/users/$target/unsuspend" '{"note":"smoke over"}')" == "204" ]] \
  && ok "support lifts the suspension" || fail "unsuspend" "$(head -c 200 "$BODY")"
moderator_id="1a9e3c5b-7d2f-4e8a-b6c1-9f0d4a2e7b44"
[[ "$(staff_api "$support_token" POST "http://admin-bff:4000/admin/v1/users/$moderator_id/suspend" '{"reasonCode":"spam"}')" == "403" ]] \
  && ok "support cannot suspend staff" || fail "support suspended staff" "$(head -c 200 "$BODY")"
[[ "$(staff_api "$support_token" PUT "http://admin-bff:4000/admin/v1/users/$target/roles" '{"roles":["support"],"note":"nope"}')" == "403" ]] \
  && ok "only platform admins change staff roles" || fail "roles by support" "$(head -c 200 "$BODY")"
req GET "$ADMIN/en/admin/users/$target"
expect_status 200 "support opens an account in the console"
req GET "$ADMIN/en/admin/operations"
expect_status 404 "support cannot open operations"
login_as "operator@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" "$ADMIN" || fail "console login as operator"
req GET "$ADMIN/en/admin/operations"
expect_status 200 "an operator opens operations"
req GET "$ADMIN/en/admin/users"
expect_status 404 "an operator never sees user data"
operator_token="$(token_from admin-bff raadi_admin_sid)"
[[ "$(staff_api "$operator_token" GET http://notifications:4000/admin/v1/notifications/queues)" == "200" ]] \
  && ok "an operator reads the delivery queues" || fail "queues" "$(head -c 200 "$BODY")"
[[ "$(staff_api "$operator_token" GET "http://admin-bff:4000/admin/v1/users/$target")" == "403" ]] \
  && ok "an operator cannot read accounts" || fail "operator account read" "$(head -c 200 "$BODY")"

section "Journeys, SLOs and account security (ADR-0031)"
eventually "every journey probe passes (blackbox exporter through the gateway)" 120 \
  q 'min(probe_success{job="journeys"}) and count(probe_success{job="journeys"}) >= 6' '.data.result[0].value[1] == "1"'
rules_ok() { curl -sf --max-time 10 http://prometheus:9090/api/v1/rules | jq -e '[.data.groups[] | select(.name | startswith("slo-")) | .rules[] | .health] | length > 50 and all(. == "ok")'; }
eventually "SLO rules evaluate without errors" 90 rules_ok
eventually "error budgets are recorded for every SLO" 120 q 'count(slo:objective:ratio)' '.data.result[0].value[1] == "6"'
req GET "$PUBLIC/en/status"
expect_status 200 "the status page answers"
grep -q 'data-testid="status-journey"' "$BODY" && ok "the status page shows the journeys' uptime" || fail "status journeys"
req GET "$PUBLIC/auth/login?reauth=1&returnTo=/en/account/security&locale=en"
[[ "$(header location)" == *"prompt=login"* ]] && ok "re-authentication asks for the password again (fresh auth_time)" || fail "reauth" "$(header location)"
req GET "$PUBLIC/auth/login?action=webauthn-register-passwordless&returnTo=/en/account/security&locale=en"
[[ "$(header location)" == *"kc_action=webauthn-register-passwordless"* ]] && ok "adding a passkey starts Keycloak's action from the website" || fail "kc_action" "$(header location)"
login_as "$USER_EMAIL" || fail "login as kari"
kari_token="$(token_from identity-bff raadi_sid)"
[[ "$(staff_api "$kari_token" GET http://identity-bff:4000/api/v1/identity/me/security)" == "200" ]] \
  && [[ "$(json '[.sessions[] | select(.current)] | length')" == "1" ]] \
  && ok "the security page reads my sessions from Keycloak with my own token" || fail "security overview" "$(head -c 200 "$BODY")"
# Kari signed in a moment ago, so the step-up check passes and Keycloak looks the method up: 404. A 401
# here would mean the fresh sign-in was not recognised (the stale case is a unit test).
[[ "$(staff_api "$kari_token" DELETE http://identity-bff:4000/api/v1/identity/me/credentials/aaaaaaaa-0000-0000-0000-000000000000)" == "404" ]] \
  && ok "a recent sign-in passes the step-up; an unknown sign-in method is not found" || fail "credential removal" "$(head -c 200 "$BODY")"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "Audit log (ADR-0028)"
login_as "admin@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}" || fail "login as admin"
req GET "$PUBLIC/api/v1/audit/entries"
[[ "$status" != "200" ]] && ok "the audit log is not on the website (console only)" || fail "audit log exposed" "HTTP $status"
admin_token="$(console_token "admin@${DEMO_EMAIL_DOMAIN:-$RAADI_DOMAIN}")" || fail "console login as admin"
audited() {
  [[ "$(staff_api "$admin_token" GET "http://audit:4000/admin/v1/audit/entries?action=$1&targetId=$2")" == "200" ]] \
    && jq -e '.items | length >= 1' "$BODY"
}
eventually "the refund is in the audit log (outbox -> Kafka -> audit)" 90 audited payment.refund "$order_id"
eventually "the moderator's removal is in the audit log" 90 audited listing.remove "$listing"
eventually "dismissed reports are in the audit log" 90 audited reports.dismiss "$kari_listing"
eventually "the suspension is in the audit log (admin-bff outbox)" 90 audited user.suspend "$target"
req POST "$PUBLIC/auth/logout" -H "origin: $ORIGIN"

section "AI gateway (ADR-0039)"
# Services reach models only through LiteLLM's aliases; by default the LLM mock answers behind them.
ai_key="sk-$(cat /run/secrets/raadi/litellm_master_key 2>/dev/null)"
ai() { # <path> <json body> [key]: prints the HTTP status, body in $BODY
  curl -s -o "$BODY" -w '%{http_code}' --max-time 60 -H "authorization: Bearer ${3-$ai_key}" \
    -H 'content-type: application/json' "http://litellm:4000$1" --data "$2"
}
status=$(ai /v1/chat/completions '{"model":"raadi-chat","messages":[{"role":"user","content":"smoke: is the sofa still for sale?"}]}')
[[ "$status" == 200 && -n "$(json '.choices[0].message.content // empty')" ]] \
  && ok "raadi-chat answers through LiteLLM" || fail "raadi-chat answers through LiteLLM" "HTTP $status: $(head -c 300 "$BODY")"
status=$(ai /v1/embeddings '{"model":"raadi-embed","input":["red leather sofa"]}')
[[ "$status" == 200 && "$(json '.data[0].embedding | length')" == 1024 ]] \
  && ok "raadi-embed returns 1024-dimension vectors (bge-m3 size)" || fail "raadi-embed returns 1024-dimension vectors" "HTTP $status: $(head -c 300 "$BODY")"
# Without a database LiteLLM can't look virtual keys up and says 400 instead of 401: refused either way.
status=$(ai /v1/chat/completions '{"model":"raadi-chat","messages":[{"role":"user","content":"x"}]}' 'sk-wrong')
[[ "$status" =~ ^4[0-9][0-9]$ ]] && ok "LiteLLM refuses a wrong key" \
  || fail "LiteLLM refuses a wrong key" "expected 4xx, got $status: $(head -c 300 "$BODY")"
curl -sf --max-time 10 http://llm-mock:4000/v1/models | jq -e '.data | length == 2' >/dev/null \
  && ok "the LLM mock serves its two models" || fail "the LLM mock serves its two models"

section "Operations"
req GET "$GRAFANA/api/health"
expect_status 200 "Grafana healthy via gateway"
eventually "all Prometheus scrape targets are up" 90 q 'count(up == 0) or vector(0)' '.data.result[0].value[1] == "0"'
eventually "identity-bff metrics arrive via OTLP" 90 q 'target_info{service_name="identity-bff"}' '.data.result | length > 0'
eventually "login counter recorded a success" 90 q 'raadi_auth_login_total{outcome="success"}' '.data.result | length > 0'
tempo() { curl -sf --max-time 10 --get --data-urlencode 'q={ resource.service.name = "identity-bff" }' \
  'http://tempo:3200/api/search' | jq -e '.traces | length > 0'; }
eventually "identity-bff traces are in Tempo" 90 tempo
loki() { curl -sf --max-time 10 --get --data-urlencode 'query={service_name="identity-bff"}' --data-urlencode 'limit=5' \
  http://loki:3100/loki/api/v1/query_range | jq -e '.data.result | length > 0'; }
eventually "identity-bff logs are in Loki" 90 loki

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$passed" "$failed"
(( failed == 0 ))
