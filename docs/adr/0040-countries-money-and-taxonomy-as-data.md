# 0040 — Countries in the data: a listing's country, money in minor units, regions, a taxonomy per country

- Status: Accepted
- Date: 2026-10-08
- Settles decisions 3 and part of 4 of [ADR-0032](0032-multi-country-marketplace.md) for listings and search.
  Updates [ADR-0024](0024-category-pages-and-filters.md) (the catalog's shape) and
  [ADR-0015](0015-search.md) (index version 5).

## Context

Listings, search and saved searches assume Norway. Prices are whole kroner (`priceNok`), a place belongs
to a Norwegian county, and the five categories with their attribute schemas, facets and ranges are fixed
lists in `@raadi/catalog`. Somaliland is the first market (ADR-0033): prices in US dollars, its own
regions and towns, and local categories such as livestock, land and solar power. The owner decided how
(2026-10-08): the country comes from the domain, Somaliland's code is `XS`, money is integer minor units
plus a currency, there is one search index with a country field, Norway stays as a second test country,
and `county` becomes `region`.

This is the first slice of a larger listings programme (smart categories, best-match ranking, deal
ratings, seller tools and a map). Each of those builds on the data model decided here.

## Decision

- **Countries are configuration** (`@raadi/catalog/countries`): code, currency and its minor-unit
  digits, languages (the default first), time zone, phone prefix and the price buckets of the price
  facet. OPA's price ceilings, which catch typos and obvious scams, are per category in minor units of
  that category's currency. Two exist: `XS` Somaliland (USD, English then Somali,
  Africa/Hargeisa) and `NO` Norway (NOK, Norwegian, Europe/Oslo). `DEFAULT_COUNTRY` names the country of
  a request that says none.
- **A listing's country is its place's country.** Places stay an offline gazetteer, now per country, and
  each place belongs to a region of its country (`region` replaces `county`). Somaliland starts with
  six regions (Maroodi Jeex, Awdal, Saaxil, Togdheer, Sanaag, Sool) and the towns under its
  administration. Disputed areas are left out until the owner decides how to show them (ADR-0033).
  Listings store `country` (a column, so queries and quotas don't depend on the gazetteer).
- **Money is `{ amountMinor, currency }`.** Listings store `price_minor` and `currency`. The currency
  must be the country's currency (one per country for now; several, with conversion, come later). The
  API returns `price: { amountMinor, currency } | null` and takes the same shape. Search takes
  `priceMin`/`priceMax` in major units of the country's currency, as people type them, and filters on
  `priceMinor`. Formatting uses the currency's own digits (`$1,250`, `1 250 kr`).
- **The taxonomy is data, one tree per country.** A category node has a stable id, optional attribute
  definitions and a price rule (required, optional or none), and children. The attribute definitions
  are declarative (select, number or text, with options, bounds, unit, `facet`, `range`, `sort`). The
  validation schemas, the search parameters, the facets, the range filters and the index mapping are
  all generated from them, so a new country or category needs no code. Ids are unique across all
  countries, because message catalogues and the index share one namespace. Norway keeps its ids
  (`torget`, `bil`, …), so existing listings stay valid. Somaliland gets its own tree: vehicles,
  property and land, phones, electronics and solar, home, fashion, livestock, agriculture, jobs,
  services, business, children, sports.
- **Two levels place a listing** (category and subcategory, as today). A third level is a navigational
  attribute (for example a laptop's `type`), which keeps the data model unchanged and lets slice 2
  show it as a category level.
- **Search: one index with a `country` field** that every query filters on (index version 5). Moving
  from version 4 copies the documents with a script that fills `country` (`NO`), `priceMinor`,
  `currency` and `region` from the old fields, so no topic re-read is needed. The index maps
  `attributes` from the union of all taxonomies, and a unit test refuses two countries using one
  attribute key with different kinds.
- **The REST API makes a clean break** (`priceNok` and `county` are gone from listings and search). The
  website and the app change in the same pull request, and `./raadi api-check` lets the planned break
  through (`API_BREAKING_OK=1`). **Events stay compatible:** the listing snapshot gains optional
  `country`, `price` and `location.region`, and keeps `priceNok` (whole kroner for NOK listings, null
  otherwise) and `location.county` (the region) for older consumers. The saved-search alert gains
  optional `price` and `previousPrice`. The `no.raadi.` prefix of event types is a namespace, not a
  country.
- **Saved searches and favourites remember the country.** Stored searches without one belong to
  Norway (all existing data is Norwegian demo data).
- **Domains:** the web resolves the country from the host through `COUNTRY_HOSTS`
  (`raadiso.com=XS`, …; a subdomain belongs to its parent's country), else `DEFAULT_COUNTRY`. Every
  search the web and the app make names its country. In this slice the development host keeps Norway, so the Norwegian tests and
  demo data keep working; Somaliland is reachable through the API (`country=XS`) and the smoke test.
  The next slice adds a second development host and makes raadi.localhost Somaliland, as decided.
- **Demo data for Somaliland:** about 300 listings in English and Somali with US dollar prices, spread
  over Somaliland's towns and categories, next to the Norwegian 500.

## Alternatives considered

- **Keep `priceNok` and add a currency next to it:** fewer changes, but every reader would have to know
  that the "kroner" field holds dollars.
- **Decimals for money:** floating-point errors, and currencies differ in digits. Integer minor units
  are the usual answer (Stripe, ISO 4217).
- **One index per country:** smaller indices, but double the mappings to keep in step, and cross-border
  features (the diaspora searching home) get harder. Owner's choice: one index.
- **A three-level category tree in the data model:** listings, events, index and saved searches would
  all change shape. A navigational attribute gives the same browsing for far less.
- **A new `.v2` listing event type:** clean, but every consumer would move at once, and the registry
  would hold two types. Optional fields are enough.

## Consequences

- One migration in listings (country, price in minor units, currency) and one in saved. The index moves
  to version 5 by itself on start.
- Payments (promotions) stay in kroner until mobile money arrives (ADR-0032 decision 4). Somaliland
  listings cannot be promoted yet.
- Category names for Somaliland need Somali translations checked by a native speaker before launch.
- Search analyzers stay Norwegian-first; English and Somali text analysis per country is slice 2's work
  (one index, text fields per language).
