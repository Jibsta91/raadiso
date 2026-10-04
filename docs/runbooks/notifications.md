# Notifications: pushes

The notifications service ([ADR-0017](../adr/0017-notifications.md), [ADR-0025](../adr/0025-push-notifications.md))
queues a push per user and notification, and a worker sends it to every device the user has, through Expo's
push service (`push-mock` in development). E-mails work the same way; see step 6 of
[event-pipeline.md](event-pipeline.md). Dashboard: **Raadi · Marketplace**, panels "Pushes by outcome" and
"Push queue and forgotten devices". Alerts: `PushQueueBacklog`, `PushesGivenUp`.

## Pushes queue up or fail (`PushQueueBacklog`, `PushesGivenUp`)

1. The last error is on each row (no message text is stored):

   ```bash
   docker compose exec postgres psql -U postgres -d notifications -c \
     "SELECT kind, status, attempts, left(last_error, 80) FROM pushes WHERE status <> 'sent' ORDER BY created_at DESC LIMIT 20"
   docker compose logs --tail=100 notifications | grep -i push
   ```

2. Typical causes:
   - Expo's push service is down or slow: check [status.expo.dev](https://status.expo.dev). Pushes are
     retried with backoff up to `PUSH_MAX_ATTEMPTS` (5) times.
   - `401`/`403` from Expo: "enhanced push security" is on for the Expo project, and the access token in
     OpenBao (`raadi/notifications`, key `push_access_token`) is missing or revoked. Create a new one in
     the Expo dashboard and store it with `./raadi secret-set` (production: through Ansible), then
     `docker compose restart notifications`.
   - `PUSH_URL` points somewhere else than `https://exp.host/--/api/v2/push/send` in production.
3. Pushes that `failed` can be re-queued once the cause is fixed. Old ones are better left alone: a push
   about a message from yesterday helps nobody.

   ```sql
   UPDATE pushes SET status = 'pending', attempts = 0, next_attempt_at = now()
    WHERE status = 'failed' AND created_at > now() - interval '1 hour';
   ```

## A user gets no pushes

`skipped` with `no device` means the app never registered a token for that user (notifications not
allowed on the phone, or signed out of the app). Tokens Expo reports as `DeviceNotRegistered` (app
uninstalled) are forgotten automatically ("devices forgotten" on the dashboard). Message pushes can also
be switched off by the user (`opted_out`), in the app or on the website.

## Development

`push-mock` accepts the same requests as Expo and keeps them in an inbox:
`http://push.raadi.localhost/messages` lists what would have reached a phone. Smoke and e2e read it.
