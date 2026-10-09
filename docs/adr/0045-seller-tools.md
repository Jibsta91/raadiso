# 0045 — Seller tools: a completeness meter, photo order, drafts, renewing, view counts

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0042](0042-best-match-ranking-and-sorts.md) (quality and freshness in best match).

## Context

Best match now rewards complete, recent listings, but sellers could not see what "complete" means, could
not choose which photo comes first, lost a half-written listing when the tab closed, had no way to bring
an older listing back up, and never learnt whether anyone looked at it.

## Decision

- **One quality score, shared:** the formula search ranks by (photos up to four, half; description up to
  400 characters, a quarter; details filled in, a quarter) moves to the catalog (`qualityOf`), so search
  and the listing form compute the same number. The form shows it as a meter with the next step that
  helps most ("add two more photos").
- **Photo order:** the form lets the seller move a photo earlier or later and make one the main photo,
  with buttons (keyboard and screen readers) rather than drag and drop. The first photo is the one
  results show; the order is the `imageIds` order the API already keeps.
- **Drafts:** a new listing's form saves itself in the browser as it is filled in (local storage, this
  device only, the uploaded photo ids included) and offers to continue the draft next time; publishing
  or discarding clears it. No server-side drafts: nothing half-written is stored about anyone.
- **Renewing:** `POST /api/v1/listings/{id}/renew` moves an active listing's publication time to now, at
  most once a week (otherwise 409 with when it can be renewed). The owner renews from their listings.
  Best match's freshness and "newest" then treat it as new, and saved searches may report it again, as a
  renewed listing on FINN does.
- **View counts:** the listing page sends one anonymous view per browser session to
  `POST /api/v1/listings/{id}/views` (no cookie, user or IP is stored, only a counter on the listing;
  the owner's own views and repeated views in a session are not counted). Owners see the count on their
  listings and on their own listing page.

## Alternatives considered

- **Drag and drop for photos:** familiar on desktops, but hard with a keyboard or a screen reader; the
  buttons work for everyone, and drag and drop can be added on top later.
- **Drafts on the server:** they would follow the seller across devices, but they are personal data that
  nobody asked us to keep; the browser is enough for now.
- **Views per day, with a chart:** more insight for sellers, more rows; a counter answers "does anyone
  look" and can grow into daily counts.

## Consequences

- One migration in listings (the view counter and when it was last renewed).
- Renewing costs a seller nothing, so it is limited to once a week per listing.
