#!/usr/bin/env bash
# Gets, or renews 30 days before expiry, a Let's Encrypt certificate for ${CERT_DOMAIN} and *.${CERT_DOMAIN}
# with a DNS-01 challenge through the GoDaddy API (ADR-0022, ADR-0023). Nothing has to be reachable from
# the internet. The ACME account and certificates stay in /acme; INSTALL=1 also makes the certificate
# Traefik's default certificate (phone mode, and the production server).
# shellcheck source=lib.sh
source /opt/raadi/bin/lib.sh
TASK="acme-cert"
DOMAIN="${CERT_DOMAIN:?CERT_DOMAIN is required}"
NAME="${CERT_NAME:-$DOMAIN}"
[[ -s "${MASTER_DIR}/godaddy_pat" ]] || die "missing secret godaddy_pat: run ./raadi secret-set godaddy_pat"

# lego's propagation pre-check never confirmed the record here (it timed out while GoDaddy's servers
# already answered with it, from the same container). GoDaddy publishes within seconds, so wait a fixed
# minute instead, and let Let's Encrypt check the record itself.
EXEC_PATH=/opt/raadi/bin/godaddy-acme.sh \
  lego run --accept-tos --path /acme --dns exec --cert.name "$NAME" \
  -d "$DOMAIN" -d "*.${DOMAIN}" --renew-days 30 --log.format text \
  --dns.propagation.wait 60s \
  || die "could not get a certificate for ${DOMAIN}"

crt="$(find /acme -name "${NAME}.crt" | head -1)"
key="$(find /acme -name "${NAME}.key" | head -1)"
[[ -s "$crt" && -s "$key" ]] || die "lego finished but left no certificate for ${NAME} in /acme"
info "certificate for ${DOMAIN} and *.${DOMAIN} valid until $(openssl x509 -in "$crt" -noout -enddate | cut -d= -f2)"
if [[ "${INSTALL:-0}" == 1 ]]; then
  dir="${INSTALL_DIR:-/certs}"; as="${INSTALL_NAME:-tls}"
  install -m 0444 -o 65532 -g 0 "$crt" "${dir}/${as}.crt"
  install -m 0400 -o 65532 -g 0 "$key" "${dir}/${as}.key"
  info "installed as ${dir}/${as}.crt"
fi
