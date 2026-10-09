# 0044 — Price history and drops: recorded by listings, carried by events, found in search

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0026](0026-favourites-and-saved-searches.md) (price-drop alerts for favourites) and
  [ADR-0043](0043-price-insight-and-guide.md) (price insight).

## Context

Favourites already alerted their owners when a price fell, but nobody else could see it: a buyer
browsing could not find reduced listings, a listing did not say it had been cheaper, and its price
history was nowhere. On FINN and most marketplaces "reduced" is one of the most used filters, and a
price history helps a buyer judge a seller who keeps lowering.

## Decision

- **Listings records every price** a listing has had (`price_history`: price, currency, when), one row per
  change, in the transaction that changes it. Existing listings start with their current price.
- **The last drop lives on the listing:** a lower price in the same currency sets `previous_price_minor`
  and `price_dropped_at`; other edits keep them; a higher price, a different currency or no price clears
  them. The API shows it as `priceDrop` (the price before, and when), and `GET
/api/v1/listings/{id}/price-history` lists the prices, newest first (public, like the listing).
- **Events carry it:** the listing snapshot gains an optional `priceDrop` (BACKWARD compatible), so search
  needs no state of its own. Search (index version 8) stores it, shows drops of the last 30 days on hits,
  filters on them (`priceDropped=true`) and sorts by them (`price_drop`, most recent first).
- **The website** marks reduced listings on cards ("reduced from" with the old price struck through), says
  on the listing page when and from what it was reduced, shows the price history, and offers the filter
  (a chip when active) and the sort. Saved searches can keep the filter, so "tell me when a car I'd buy
  gets cheaper" works with the alerts that exist.
- **Demo data:** about one listing in eight had a higher price first (chosen by id, deterministic).

## Alternatives considered

- **Search remembering the previous price itself** (reading the old document before writing): state and a
  read per event in the indexer, and a reindex would lose it. The listing owns its prices.
- **Showing every drop forever:** after a month a drop says little; the listing keeps it, search shows it
  for 30 days.

## Consequences

- One migration in listings and an index version bump in search (no topic re-read: old documents simply
  have no drop).
- A seller who raises the price clears the "reduced" mark, so it cannot be gamed by raising and lowering
  without the history showing it.
