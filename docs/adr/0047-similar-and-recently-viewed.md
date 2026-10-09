# 0047 — Discovery: similar listings from search, recently viewed in the browser

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0041](0041-search-2-understanding-relevance-autocomplete.md) (the language fields).

## Context

A buyer on a listing that wasn't quite right had to go back to the results; one who left the site had to
search again for what they had looked at. Both are the most used ways back into a marketplace, and
neither needs a model: search already knows which listings share words, subcategory and price.

## Decision

- **Similar listings** (`GET /api/v1/search/listings/{id}/similar`): OpenSearch more-like-this on the
  listing's title and description in its country's language fields, among active listings of the same
  country; the same subcategory, the same category and a price within half to one and a half times rank
  higher. When the words find fewer than eight, the subcategory's newest fill the row. The listing page
  shows them below the listing.
- **Recently viewed:** the listing page remembers the listing (title, price, first photo, place) in the
  browser's local storage, the twelve latest; the front page shows them with a button to clear them.
  Nothing is sent anywhere, and the owner's own listings are not remembered.

## Alternatives considered

- **Embeddings for similarity:** better at meaning, but they need a model (Phase 4, on hold).
- **Recently viewed on the server, per account:** follows people across devices, but it is a viewing
  history we would have to protect and delete; the browser keeps it closer to the person.

## Consequences

- The row is as good as the words in titles and descriptions; the subcategory fallback keeps it full.
- The remembered prices can be out of date; the listing page shows the current one.
