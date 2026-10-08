# 0043 — Price insight: deal ratings against comparable listings, a price guide for sellers

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0040](0040-countries-money-and-taxonomy-as-data.md) (the taxonomy as data) and
  [ADR-0042](0042-best-match-ranking-and-sorts.md) (best match).

## Context

A buyer looking at a Land Cruiser for $18,000 cannot tell whether that is cheap. A seller listing camels
guesses a price. The big classifieds (CarGurus' deal ratings, FINN's price statistics) answer both
questions from their own listings, and a price far below everything comparable is one of the strongest
signs of a scam. The demo market already has enough listings per category to do the same, and the search
index holds every active listing's price and details.

## Decision

- **What counts as comparable is data in the taxonomy:** a category or subcategory can say which details
  must match (`same`: make and model, brand and storage, property type), which numbers must be close
  (`near`: model year within two, bedrooms within one), whether to compare within the region, and the unit
  of the price (`per`: the listing, a square metre for property and land, an animal for livestock). Without
  a rule, listings compare within their subcategory.
- **Price statistics come from the search index:** the active listings of the same country and
  subcategory that match the rule, the listing itself excluded, give the 25th, 50th and 75th percentile of
  the unit price (OpenSearch `percentiles`). With fewer than four, the rule is loosened to the subcategory
  and region, then to the subcategory alone; with still fewer there is no rating. The insight says how
  loose the comparison was.
- **The rating:** below half the median is **unusually low** (shown as a warning to check carefully, with
  the safety tips, never as a bargain); at or below the 25th percentile **great**; at or below the median
  **good**; at or below the 75th **fair**; above it **high**.
- **Where it shows:** the listing page has a price insight box (rating, the comparables' range and median,
  how many, what was compared); result cards show "great price" and "good price" only (computed for the
  page's hits in one multi-search, cached per comparable group for a minute); the listing form shows a
  price guide while the seller fills in the details. Public endpoints of the search service:
  `GET /api/v1/search/listings/{id}/price-insight` and `GET /api/v1/search/price-guide`.

## Alternatives considered

- **Ratings computed at index time and stored on each listing:** cheaper to read, but stale as the market
  moves and every new listing would change other listings' ratings.
- **A price model (regression on make, year and mileage):** more precise for cars, but per-category
  models are Phase 4 work; percentiles of real comparables are honest and explainable.
- **Showing "high price" on cards:** it would shame sellers in the list view; the listing page explains
  it with the numbers.

## Consequences

- The ratings are only as good as the number of comparables; small categories show none.
- The "unusually low" warning is a trust and safety signal the moderation queue can use later.
- New categories get comparisons within their subcategory by default; a `compare` rule refines them.
