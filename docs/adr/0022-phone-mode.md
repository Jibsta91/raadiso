# 0022 — Phone mode: the project's own domain, LAN DNS and a Let's Encrypt certificate

- Status: Accepted
- Date: 2026-10-03

## Decision

- **`./raadi phone`** runs the development stack for a phone on the same Wi-Fi. It starts the normal stack
  under `RAADI_DOMAIN=$PHONE_DOMAIN` (default `dev.raadiso.com`) with HTTPS, adds `compose.phone.yaml`, and
  binds the gateway to the laptop's LAN address. Everything else (Keycloak URLs, the BFF, CSP) already
  derives from `RAADI_DOMAIN`. `./raadi up` switches back.
- **DNS**: a one-shot `phone-dns` job points `$PHONE_DOMAIN` and `*.$PHONE_DOMAIN` at the laptop's LAN
  address through GoDaddy's DNS records API (v3, with a scoped Personal Access Token). It accepts only
  private IPv4 addresses and writes only when they changed.
- **TLS**: a one-shot `phone-cert` job runs lego (MIT, copied into the init image) with a **DNS-01**
  challenge to get or renew a Let's Encrypt wildcard certificate. lego's GoDaddy provider supports only the
  older key and secret, so its `exec` provider calls our hook (`godaddy-acme.sh`), which adds and removes the
  challenge TXT records with the token. It installs the certificate as Traefik's default certificate, in the
  same place as the development CA's. Phones trust it out of the box, nothing needs to be reachable from
  the internet, and renewal happens 30 days before expiry. The ACME account and certificate are kept in
  the `acme` volume.
- **Metro** runs in an `expo` container on port 8081 of the LAN address, with
  `REACT_NATIVE_PACKAGER_HOSTNAME` set so Expo Go connects to the laptop. `--offline` avoids Expo's online
  services. The app is built with the phone-mode URLs (`app.config.ts` reads `PUBLIC_BASE_URL` and
  `AUTH_BASE_URL`).
- **Secrets the user supplies** (the GoDaddy token, `godaddy_pat`) are stored with `./raadi secret-set` in the
  secrets volume, next to the generated secrets, from a hidden prompt. That command refuses to overwrite a
  generated secret.

## Alternatives considered

- **sslip.io or nip.io with the development CA**: needs no domain, but every phone must install and
  manually trust a CA profile, and the stack depends on a third-party DNS service.
- **Expo tunnels (ngrok)**: an external relay for all app traffic, which goes against running offline and
  OSI-only (ADR-0009).
- **Traefik's own ACME resolver**: needs a different static configuration in development. A one-shot job
  keeps Traefik's configuration identical across modes, and it can serve production's DNS-01 needs later
  (Phase 5).

## Consequences

- Phone mode needs internet access, for DNS and Let's Encrypt, and a GoDaddy Personal Access Token. The
  default mode still runs offline.
- The domain's public DNS holds a private LAN address. That reveals nothing reachable, but some routers'
  DNS-rebinding protection blocks such answers (see docs/mobile.md).
- While phone mode runs, the development stack, with its demo passwords, is reachable from the LAN.
  Since 2026-10-06 phone mode serves only what a phone needs (the website and API, sign-in, the mock
  payment page and the push mock's read-only log). The admin console, Keycloak's admin console, Mailpit,
  OpenBao, the Traefik dashboard and Prometheus stay off the network (`DEV_TOOLS_ROUTED=false`,
  `KEYCLOAK_ADMIN_PUBLIC=false`), because the demo staff logins and the one-time-code secret are public in
  this repository. `PHONE_TOOLS=1 ./raadi phone` serves them anyway.
