# 0050 — Price insight switched off (PRICE_INSIGHT=false)

- Status: Accepted
- Date: 2026-10-09
- Changes [ADR-0043](0043-price-insight-and-guide.md) (price insight) and the cards of
  [ADR-0048](0048-app-2-home-cards-photos.md).

## Context

The owner asked for the price check and the deal ratings to be turned off. Comparables are thin while
the marketplace is new: a "great price" or an "unusually low" warning based on a handful of listings
can mislead buyers and annoy sellers.

## Decision

- **One switch in search:** `PRICE_INSIGHT` (default `false`). While it is off, search answers no
  price insight (`/listings/{id}/price-insight` returns `insight: null`), no price guide
  (`/price-guide` returns `guide: null`), and no `deal` on hits. It also stops querying comparables for
  every results page.
- **No client changes:** the website and the app already show nothing when search has nothing to say.
  That removes the price check on listings, the "Great/Good price" badges on cards and the sellers'
  price guide in the listing form, on both.
- **The code stays.** `PRICE_INSIGHT=true` turns all three on again. The e2e suite follows the setting:
  the price-check test runs when it is on, and a check that nothing shows runs when it is off.
- Price drops ([ADR-0044](0044-price-history-and-drops.md)) are not affected.

## Alternatives considered

- **Removing the feature:** less code, but bringing it back once there are enough listings would mean
  rebuilding it.
- **Hiding it in each client:** three places to keep in step, and search would keep doing the work.

## Consequences

- `.env`, `.env.example` and the search service's compose entry carry `PRICE_INSIGHT`; the toolbox
  passes it to the e2e tests.
