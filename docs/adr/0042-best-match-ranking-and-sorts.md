# 0042 — Best match: quality and freshness in the ranking, sorts per category, a ranking lab

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0041](0041-search-2-understanding-relevance-autocomplete.md) (search 2.0). Index version 7.

## Context

"Best match" ranked by text score alone, and without words (a category page, a filter) by publication
time. A listing with one blurry photo and no details ranked like a complete one, and a three-week-old
listing like this morning's. Sorting offered price, newest and distance only, whatever the category: a car
buyer could not ask for the newest model year or the lowest mileage, a house hunter not for the lowest
price per square metre. And nobody could see why a listing ranked where it did.

## Decision

- **Quality** is computed when a listing is indexed, from what the seller gave: photos (up to four, half
  of the score), the description's length (a quarter) and how many of the category's details are filled
  in (a quarter). It is a number from 0 to 1 in the index (`quality`), with `imageCount`. Documents copied
  from version 6 get it from their photos and description.
- **Best match** multiplies the text relevance by `(1 + quality weight × quality)` and by
  `(1 + freshness weight × freshness)`, where freshness decays from 1 to a half over 14 days after a
  2-day grace (Gaussian, on `publishedAt`). One Painless score script; the weights default to 0.5 and 0.5.
  Paid promotions still come first (ADR-0020), and explicit sorts don't score. Without words, the same
  multipliers order the results, so a category page shows good, recent listings first instead of only
  recent ones. The judged queries of ADR-0041 must keep their floor.
- **Sorts per category,** generated from the taxonomy: a number attribute can declare its useful order
  (`sort: 'desc'` for year, area, storage and herd size; `'asc'` for mileage), which becomes a sort
  (`year_desc`, `mileage_asc`, …), and categories with an area also get the lowest price per square metre
  (`price_per_area_asc`, a script sort). The website offers a category's sorts when one category is
  selected; listings without the attribute come last.
- **A ranking lab in the console** (operators and platform admins): a query, a country and the two
  weights; it shows the ranked listings with each one's text relevance, quality, freshness, the
  multipliers and whether it is promoted. It previews weights without saving them; the defaults change by
  pull request, with the judged queries as the check. Read-only, so it needs no audit entry.

## Alternatives considered

- **Learning to rank** (the OpenSearch LTR plugin, a model trained on clicks): the strongest ranking, but it
  needs click logs and a trained model, which wait for Phase 4 and real traffic.
- **Seller diversity** (no more than two listings per seller on a page): OpenSearch can only collapse a
  seller to one hit, and re-ordering one page breaks paging. Left until there are sellers with many
  listings to see whether it is needed.
- **Weights stored and edited live from the console:** the search service has no database and an audit
  trail for it would need one; previewing in the lab and changing the defaults by pull request keeps
  every change reviewed and measured.

## Consequences

- Index version 7 (two fields); the copy from version 6 computes them.
- A seller can raise their listings' rank only by giving buyers more: photos, a description, details.
- New attributes declare whether they sort; new categories with an area get price per square metre.
