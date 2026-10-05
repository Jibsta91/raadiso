# Moderation: reports, removals and blocks

Users report listings (reason and comment); moderators work the queue in the admin console
(`admin.<domain>` → Moderation, [ADR-0027](../adr/0027-reports-and-blocking.md),
[ADR-0028](../adr/0028-admin-console-staff-roles-and-audit.md)). Removing a listing resolves its reports,
and dismissing closes them; both are written to the audit log. Dashboard: **Raadi · Marketplace**, panels
"Reports by reason and outcome", "Moderation backlog" and "Blocks". Alerts: `ModerationQueueStale`,
`ReportsSpike`.

## The queue is not being worked (`ModerationQueueStale`)

A listing has had an open report for more than a day. Nothing is broken: moderators need to get to it.

1. Check how big the backlog is and which listings wait longest:

   ```bash
   docker compose exec postgres psql -U postgres -d listings -c \
     "SELECT listing_id, count(*), min(created_at) FROM reports WHERE status = 'open'
       GROUP BY listing_id ORDER BY min(created_at) LIMIT 20"
   ```

2. If the console shows an empty queue while the query above does not, the console cannot reach listings
   (`docker compose logs --tail=50 web listings`) or the moderator lacks the role `moderator` (Keycloak →
   realm `raadi` → Users → Role mapping).

## Many reports at once (`ReportsSpike`)

Usually a scam wave (the same kind of listing from new accounts) or one bad seller. Sort the queue by
count in the console, remove what breaks the rules, and dismiss the rest. Each person can hold at most 20
open reports, so one account cannot flood the queue on its own; many accounts reporting the same listings
points at a coordinated campaign against a seller: dismiss, and note it for the trust and safety review.

## Blocks

People block each other from a conversation; the blocked person only sees that it is closed. A spike in
"Blocks" with one counterpart in common points at a harassing account. Blocks are not staff actions and
are not audited. Look up conversations in the `messaging` database (`blocks` table, ids only).

## Remove a review

Moderators and platform admins remove a review from the reviewed user's profile (`/users/<id>`) with
"Remove review". The removal is audited as `review.remove`. See [trust.md](trust.md).
