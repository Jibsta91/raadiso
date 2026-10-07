# Domain, DNS and certificates (raadiso.com)

Raadiso's domain is **raadiso.com**, registered at GoDaddy, with its DNS also hosted by GoDaddy
([ADR-0023](adr/0023-domain-dns-and-tls.md)). Two `./raadi` commands manage it through GoDaddy's DNS API. Both
work from a laptop and expose nothing to the internet.

| Command                               | Does                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `./raadi dns <server-ip> [--dry-run]` | Points `raadiso.com` and `*.raadiso.com` at a server's public IPv4 address                 |
| `./raadi cert [--install]`            | Gets or renews the Let's Encrypt wildcard for `raadiso.com` and `*.raadiso.com` (DNS-01)   |
| `./raadi phone`                       | The same for `dev.raadiso.com` on the LAN, for testing on a phone ([mobile.md](mobile.md)) |

Both take another domain inside the zone as an argument (for example `./raadi cert staging.raadiso.com`).

## Once: the GoDaddy token

At <https://developer.godaddy.com/keys>, create a Personal Access Token with the scopes
`domains.domain:read` and `domains.dns:update`. Store it from your own terminal. The input is hidden, and the
token never goes into the repository or a chat:

```bash
./raadi secret-set godaddy_pat
```

The token lives in the stack's secrets volume. Rotate it by creating a new one, storing it the same way and
revoking the old one at GoDaddy.

## Certificates

`./raadi cert` runs lego with a DNS-01 challenge:

1. It adds a `_acme-challenge` TXT record through the API.
2. It waits a minute (GoDaddy publishes within seconds).
3. Let's Encrypt checks the record, and lego removes it.

The ACME account and the certificates are kept in the `acme` volume. A run renews only when fewer than 30
days remain, so it is safe to run daily. `--install` copies the certificate to where Traefik reads its
default certificate (the `certs` volume), replacing the development CA's. The development stack's `certs-init`
keeps a certificate that matches the domain, so an installed certificate survives restarts.

On the production server (Phase 5), a daily timer runs `./raadi cert --install` and then restarts
Traefik when the certificate changed. Ansible sets it up together with the rest of the server.

## DNS

`./raadi dns <ip>` sets the A records `@` and `*` of the zone and changes only what differs. It refuses
private and reserved addresses, which belong in phone mode. Use `--dry-run` to see what would change:

```bash
./raadi dns 203.0.113.10 --dry-run
```

Phone and tunnel mode manage their own records: `dev` and `*.dev` (the laptop's LAN address in phone
mode, the home's public address in tunnel mode), and `pangolin` and `*.pangolin` for the Pangolin
dashboard in tunnel mode ([ADR-0034](adr/0034-tunnel-mode-pangolin.md)). They have their own wildcard
certificates in the same `acme` volume.

Today `raadiso.com` shows GoDaddy's parking page (an A record with the value `Parked`), and the wildcard has
no record. The first real `./raadi dns` with the server's address replaces both. Keep the TTL at 600 seconds
(GoDaddy's minimum) while moving servers.
