# Deploying to production

Raadiso runs on one server with the same compose files as development, plus `compose.prod.yaml`
([ADR-0051](adr/0051-production-on-one-server.md)). Everything below runs from your laptop, in this
checkout, over SSH. On top of Docker you need `ssh` and `rsync`.

## Once: the server

1. A server with Ubuntu and Docker Engine plus the Compose plugin from Docker's apt repository, an admin
   user with sudo, and SSH key login (password and root logins off).
2. Copy `deploy/prod/local.env.example` to `deploy/prod/local.env` (Git ignores it) and fill in:
   - `DEPLOY_HOST`: the deploy user at the server, for example `prod@ovh`, where `ovh` is an alias in
     `~/.ssh/config`. An explicit user overrides the alias's `User`.
   - `DEPLOY_ADMIN_HOST`: the admin user's SSH destination, for example `ovh`.
3. `./raadi deploy setup` prepares the server (idempotent). It creates the `prod` user (no password,
   in the `docker` group, with the admin user's SSH keys) and `/home/prod/raadi` with `secrets/` at 0700.
   It also opens ufw for 22, 80 and 443, keeps unattended security upgrades on, bounds the journal
   (1 GB) and Docker's logs (20 MB × 5 per container), and adds 4 GB of swap. The first run restarts
   Docker once to apply the log settings.

## Every release

```bash
git switch main && git pull     # deploy what was merged
./raadi deploy                  # rsync, write .env, build on the server, up --wait, print the summary
```

`./raadi deploy` refuses uncommitted changes (`DEPLOY_DIRTY=1` overrides). The commit it deployed is
in `/home/prod/raadi/.deployed`. Extra arguments go to `docker compose up`, for example
`./raadi deploy up search`.

The server's `.env` is `.env.example`, then `deploy/prod/prod.env`, then your `local.env`: the last
value of a key wins. It sets `COMPOSE_FILE`, so plain `docker compose` on the server uses the
overlay too.

## Certificates and DNS

Certificates come from Let's Encrypt by DNS-01 through GoDaddy, so the server needs no DNS before its
first certificate ([docs/domain.md](domain.md)).

```bash
./raadi deploy secret-set godaddy_pat   # once; input hidden, stored only on the server
./raadi deploy cert                     # get or renew raadiso.com + *.raadiso.com, restart Traefik
```

Renewal: run `./raadi deploy cert` again; it renews within 30 days of expiry and does nothing before
that. Check what the server serves before DNS points at it:

```bash
curl -sI --resolve raadiso.com:443:<server-ip> https://raadiso.com/
```

Then point the domain at the server: `./raadi dns <server-ip> --dry-run`, then without `--dry-run`.

## Mail

Sign-up needs a verified e-mail address, so set up a mail provider (SMTP) before inviting anyone.
Uncomment the `SMTP_*` lines in `local.env`, run `./raadi deploy secret-set smtp_password`, then
`./raadi deploy`. Keycloak and notifications pick it up.

Raadiso uses Brevo (free plan, 300 mails a day): `smtp-relay.brevo.com`, port 587 (STARTTLS), the
login `…@smtp-brevo.com`. The password is an **SMTP key** (`xsmtpsib-…`), not the API key
(`xkeysib-…`). Brevo refuses unknown addresses for both, so authorise the server's IP (and yours, for
API calls) under Security → Authorised IPs. The sender domain needs Brevo's two DKIM CNAMEs
(`brevo1._domainkey`, `brevo2._domainkey`) and its `brevo-code` TXT on the apex; the GoDaddy helper
in `deploy/init/scripts/godaddy.sh` can add them (`gd_set`, `gd_add`).

## Day to day

Any other `./raadi` command runs on the server:

```bash
./raadi deploy status            # health and memory of every service
./raadi deploy logs search       # follow one service's logs
./raadi deploy secret grafana_admin_password
```

The admin console (`https://admin.<domain>`) and Grafana (`https://grafana.<domain>`) are served:
staff sign in through Keycloak with a staff role and their own one-time code. GlitchTip
(`errors.`), Prometheus, Traefik's dashboard (`traefik.…/dashboard/`), Keycloak's admin console
(`auth.…/admin/`) and Arcane (`arcane.`, when it runs) are served behind the staff gate (ADR-0054): platform admins only,
with a one-time code, then the tool's own login. OpenBao is never served.
Reach it, or any tool, through an SSH tunnel to the container's address on the server, for example Prometheus
(then open http://localhost:9090):

```bash
ip=$(ssh prod@ovh "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' raadi-prometheus-1")
ssh -N -L "9090:${ip}:9090" prod@ovh
```

## Arcane (the Docker UI)

Arcane ([ADR-0058](adr/0058-arcane-instead-of-dockhand.md)) runs next to the stack, started on its own,
and is served on `arcane.<domain>` behind the staff gate. On the server, as the `prod` user in
`/home/prod/raadi`, after a deploy has copied `deploy/arcane/compose.yaml`:

```bash
umask 077 && printf 'ENCRYPTION_KEY=%s\nJWT_SECRET=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 32)" \
  > deploy/arcane/arcane.env
docker compose -p arcane --env-file .env -f deploy/arcane/compose.yaml up -d --wait
```

`--env-file .env` gives the compose file the stack's `RAADI_DOMAIN` (for `APP_URL`); `-p arcane` keeps it
its own project, as `.env` also sets the stack's `COMPOSE_PROJECT_NAME`. Keep a copy of
`ENCRYPTION_KEY` in the owner's password manager: it decrypts what Arcane stores. `JWT_SECRET` only signs
sessions; a new one signs everyone out. The first deploy that ships `arcane.env` in `.gitignore` can still
delete the file (rsync reads the server's old `.gitignore`): write it after that deploy.

Then add `ARCANE_URL=http://arcane:3552` to `deploy/prod/local.env` on your laptop and run
`./raadi deploy`. Open `https://arcane.<domain>`: first the staff gate, then Arcane's own login. Its first
login is `arcane` / `arcane-admin`: change it at once (at least 12 characters with a symbol) and store it
in the password manager. Upgrade by changing the pinned image in the compose file.

Settings made in Arcane (Settings, or `PUT /api/environments/0/settings`), as set on 2026-10-11:

- Base server URL `https://arcane.<domain>`; Gravatar off; sessions end after 240 minutes; activity kept
  90 days.
- Auto-update, auto-heal and image auto-patch **off**: the stack's images are pinned by digest and change
  only through a deploy, and Docker's restart policies already restart containers.
- Vulnerability scan (Trivy) daily at 04:30 UTC, 1 CPU and 1 GiB, unfixed findings hidden.
- Scheduled prune on Sundays at 04:00 UTC: dangling images and build cache older than 7 days only; never
  containers, networks or volumes (the stack's init containers and data live there).

Moving from Dockhand: stop and remove it with its own compose file, then do the above. Its old
`dockhand.<domain>` route went away with `DOCKHAND_URL`.

## Not in production

- Demo users, listings and one-time codes (`SEED_DEMO_DATA=false`): the first staff account is made in
  Keycloak's admin console over a tunnel.
- Payments: `PAYMENTS_PROVIDER=none` until a provider for the country is chosen; promotions show as
  unavailable.
- BankID verification: no identity provider for Somaliland yet.
