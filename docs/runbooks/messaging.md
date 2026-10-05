# Messaging

The messaging service ([ADR-0016](../adr/0016-messaging.md)) stores conversations, sends over REST and pushes
new messages over a WebSocket (`/api/v1/messaging/ws`). Instances share events through Valkey pub/sub
(`messaging:events`). Dashboard: **Raadi · Marketplace**, panels "Messages sent/s" and "Live connections
(WebSocket)". Alert: `WebSocketOriginRejected`.

## Messages arrive only after a reload

Sending works but live delivery does not.

1. "Live connections" at 0 while people are online: the WebSocket handshake fails. The rejections by
   reason are in `raadi_messaging_ws_rejected_total`:
   - `token`: the access token is missing or expired (the BFF did not forward it; see
     [auth-anomalies.md](auth-anomalies.md)).
   - `origin`: the browser's origin differs from messaging's `PUBLIC_BASE_URL` (see below).
   - `too_many`: one user holds more than 5 sockets (many tabs, or a client that leaks connections).
2. Connections exist but nothing arrives: Valkey pub/sub. `docker compose logs --tail=50 messaging valkey`;
   messaging's Valkey ACL user may only `PUBLISH`/`SUBSCRIBE` on `messaging:*`, and a `NOPERM` error means
   the ACL file and the code disagree on the channel name.
3. Traefik must pass the upgrade: the `messaging-ws` router in `deploy/traefik/dynamic/common/routes.yml`.

## Handshakes from foreign origins (`WebSocketOriginRejected`)

Either someone tries cross-site WebSocket hijacking (a page on another site opening a socket with the
user's cookie), which is refused and needs no action, or the public origin changed (new domain, `phone`
mode) and messaging's `PUBLIC_BASE_URL` was not updated. Compare it with the `Origin` users actually send:
`docker compose logs messaging | grep -i origin`.

## "You can no longer send messages in this conversation"

The listing is gone, or one side blocked the other (`conversation_closed`; the same answer for both, so
the blocked person does not learn about the block). Support can see whether a block exists, but must not
tell the blocked person.

```bash
docker compose exec postgres psql -U postgres -d messaging -c "SELECT * FROM blocks WHERE blocker_id = '<user>' OR blocked_id = '<user>'"
```
