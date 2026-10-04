#!/usr/bin/env bash
# Runs once every service is healthy: verifies the public routes through the
# gateway, prints the URLs and demo logins, then stays up (healthy) as the
# platform's readiness sentinel.
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="summary"

# The gateway inside the network: port 443 when the public URLs are https (phone mode, production).
GW="${GATEWAY_INTERNAL:-traefik:$([[ "${PUBLIC_SCHEME:-http}" == https ]] && echo 443 || echo 80)}"
# up <url> — true when the URL answers 2xx/3xx through the gateway (public Host header).
up() {
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --connect-to "::${GW}" "$1")" =~ ^[23][0-9][0-9]$ ]]
}

declare -A urls=(
  [web]="${PUBLIC_BASE_URL}/"
  [mobile-web]="${PUBLIC_BASE_URL}/m/"
  [auth]="${AUTH_BASE_URL}/realms/${KEYCLOAK_REALM:-raadi}/.well-known/openid-configuration"
  [grafana]="${GRAFANA_BASE_URL}/api/health"
  [search]="${PUBLIC_BASE_URL}/api/v1/search/listings?pageSize=1"
)
for name in "${!urls[@]}"; do
  retry 20 up "${urls[$name]}" || warn "${name} did not answer through the gateway: ${urls[$name]}"
done

S="${PUBLIC_SCHEME:-http}"; D="${RAADI_DOMAIN}"; P="${PUBLIC_PORT_SUFFIX:-}"; E="${DEMO_EMAIL_DOMAIN:-$D}"
cat <<BANNER

  ┌────────────────────────────────────────────────────────────────────┐
  │  Raadi is up  ·  environment: ${RAADI_ENV:-development}
  └────────────────────────────────────────────────────────────────────┘

  App & APIs
    Web app ............ ${PUBLIC_BASE_URL}
    API (via gateway) .. ${PUBLIC_BASE_URL}/api/v1/
    Login (Keycloak) ... ${AUTH_BASE_URL}/realms/${KEYCLOAK_REALM:-raadi}/account
    Search listings .... ${PUBLIC_BASE_URL}/en/search
    Sell something ..... ${PUBLIC_BASE_URL}/en/listings/new   (log in as a demo user)
    Messages ........... ${PUBLIC_BASE_URL}/en/messages
    Notifications ...... ${PUBLIC_BASE_URL}/en/notifications   (e-mails land in Mailpit below)
    Verify with BankID . ${PUBLIC_BASE_URL}/en/account   (test person 01897000011, demo password)
    Promote a listing .. ${PUBLIC_BASE_URL}/en/my/listings   (test payments at pay.${RAADI_DOMAIN})
    Status page ........ ${PUBLIC_BASE_URL}/en/status
    Mobile app (web) ... ${PUBLIC_BASE_URL}/m/   (phones: see docs/mobile.md)

  Operations
    Grafana ............ ${GRAFANA_BASE_URL}   (log in with a platform admin below;
                         dashboards: Platform overview, Marketplace, Services, Gateway)
    Keycloak admin ..... ${AUTH_BASE_URL}/admin/   (user: admin, password: ./raadi secret keycloak_admin_password)
    OpenBao UI ......... ${S}://bao.${D}${P}/ui/   (token: ./raadi secret openbao_root_token)
    Traefik dashboard .. ${S}://traefik.${D}${P}/dashboard/
    Prometheus ......... ${S}://prometheus.${D}${P}
    Mailpit (emails) ... ${S}://mail.${D}${P}
    Push mock (app) .... ${S}://push.${D}${P}/messages   (pushes to the app, in development)

  Demo logins (password for all: ${DEMO_USER_PASSWORD:-<seed disabled>})
    kari.nordmann@${E}   buyer/seller (nb)
    ola.nordmann@${E}    buyer/seller (nb)
    amina.hassan@${E}    buyer/seller (en)
    moderator@${E}       content moderator
    support@${E}         customer service (admin console)
    operator@${E}        platform operations (admin console, Grafana editor)
    admin@${E}           platform admin (Grafana, admin APIs)

  HTTPS works too (https://${D}) with a locally generated dev CA:
  trust it optionally with ./raadi ca-cert. Plain HTTP needs nothing.

BANNER

# Stay up as a readiness sentinel: healthy == platform verified, so
# `docker compose up --wait` returns only when everything above is true.
touch /tmp/ready
trap 'exit 0' TERM INT
sleep infinity &
wait
