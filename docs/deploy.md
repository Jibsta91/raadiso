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

## Day to day

Any other `./raadi` command runs on the server:

```bash
./raadi deploy status            # health and memory of every service
./raadi deploy logs search       # follow one service's logs
./raadi deploy secret grafana_admin_password
```

Grafana, Keycloak's admin console, the admin console and the dev tools are not routed in production.
Reach them through an SSH tunnel to the container's address on the server, for example Grafana
(then open http://localhost:3001):

```bash
ip=$(ssh prod@ovh "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' raadi-grafana-1")
ssh -N -L "3001:${ip}:3000" prod@ovh
```

## Not in production

- Demo users, listings and one-time codes (`SEED_DEMO_DATA=false`): the first staff account is made in
  Keycloak's admin console over a tunnel.
- Payments: `PAYMENTS_PROVIDER=none` until a provider for the country is chosen; promotions show as
  unavailable.
- BankID verification: no identity provider for Somaliland yet.
