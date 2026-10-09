# 0046 — Smart categories: a third level, categories from what is being sold, reduced listings per category

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0040](0040-countries-money-and-taxonomy-as-data.md) (two levels place a listing, a
  third is a navigational attribute) and [ADR-0041](0041-search-2-understanding-relevance-autocomplete.md)
  (the lexicon).

## Context

ADR-0040 kept listings at two levels and promised a third as a navigational attribute. Sellers started a
new listing by browsing category tiles even when they knew exactly what they sold, and category pages
showed only the newest listings.

## Decision

- **A third level, from the taxonomy:** a select attribute can be marked `nav` (computers' and solar
  power's item type, phone and tablet brands). With one subcategory chosen, search shows its values as
  chips with counts above the results, toggling the filter. Nothing changes in the data model.
- **"What are you selling?":** the first step of a new listing has a text field; the words go through
  search's autocomplete (the lexicon of ADR-0041), and the suggested subcategories are buttons that pick
  the category and subcategory and start the title with the words typed. The tiles stay for browsing.
- **Reduced listings per category:** a category page shows the recently reduced listings of the
  category (ADR-0044) in a row of their own, when there are any.
- Make and model words for Norway's electronics (iPhone, Samsung, PlayStation) join the lexicon as hint
  words, so they suggest and imply the category but still match as text.

## Consequences

- New subcategories get a third level by marking one attribute `nav`.
- The sell flow's suggestions are only as good as the lexicon; adding words there improves search and
  selling at once.
