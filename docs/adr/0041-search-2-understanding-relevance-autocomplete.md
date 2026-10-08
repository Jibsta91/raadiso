# 0041 — Search 2.0: query understanding, multilingual matching, measured relevance, autocomplete

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0015](0015-search.md) (search) and [ADR-0040](0040-countries-money-and-taxonomy-as-data.md)
  (countries and the taxonomy as data). Index version 6.

## Context

Search matched words in titles and descriptions, every word required, through a Norwegian analyzer. Tried
against the demo data on 2026-10-09:

- `car` in Somaliland found a toy car and a car battery but no cars: cars are titled "Toyota Vitz".
  `phone` ranked repairs and cases above phones. Search did not know what a listing _is_.
- `elbil` and `house for rent` found nothing: no synonyms, no understanding of attribute values.
- `billig sykkel` and `cheap phone` found nothing: every word had to match, and "cheap" never does.
- `ski` found a motorhome and garden furniture, because Ski is also a town ("Henting i Ski"), and
  `hargeisa` returned 77 unrelated listings: place names were matched as text, not understood as places.
- English and Somali text went through a Norwegian stemmer, the website had no autocomplete, and a search
  with no results was a dead end.

The owner asked for search to be "way better". AI is on hold (the laptop cannot run models), so the answer
has to come from the catalog and OpenSearch.

## Decision

- **A lexicon in the catalog** (`@raadi/catalog/lexicon`, zod-free): for every category and subcategory, and
  for attribute values people type (electric, automatic, iPhone, foreign used, for rent), the words people
  use in each language of the country, plurals and common synonyms included (car, cars, baabuur, gaari;
  phone, mobile, taleefan). A unit test requires words for every category in its country's main
  language and refuses words for categories or values that don't exist.
- **Query understanding** (search service, deterministic): the query is split into words and matched,
  longest phrase first, against the country's lexicon, its places (names and local spellings) and its
  regions, and against price phrases (`under 500`, `max 500`, `ilaa 500`, `opp til 500`, `500–1000`) and
  intent words (cheap, billig, jaban, raqiis: cheapest first). What is recognised becomes filters and a
  sort; what is left is the text query. Only what the request did not set itself is applied, and only
  the first category or place. The response says what was understood, so the website shows each part as
  a chip that removes it, and `understand=false` turns it off (the website's "search all words" link).
  Saved searches replay the same query and get the same interpretation.
- **Matching that knows what listings are:** words of the query that the lexicon knows but that were not
  taken as a filter (a second category word, a partial match) boost the categories, subcategories and
  attribute values they name, at query time. Nothing is copied into the documents, so the taxonomy can
  change without reindexing. Titles and descriptions get English and Somali subfields next to the
  Norwegian ones, and the country decides which are searched (Somaliland: English and Somali; Norway:
  Norwegian and English). The lexicon's synonym groups (fridge, refrigerator, talaagad) apply at search
  time (`synonym_graph`).
- **Relevance:** `most_fields` across title, category, attribute and description fields, with most words
  required rather than all (`2<-25%`: up to three words all, then a quarter may be missing). Exact
  phrases in the title score extra; descriptions weigh least. Typo tolerance starts at five letters. Paid
  promotions and the sort orders behave as before.
- **No dead ends:** a search with no hits is retried with any single word allowed to match; the response
  marks it `relaxed` and the website says "no exact matches, similar listings". A phrase suggester on titles
  offers "did you mean".
- **Autocomplete** (`GET /api/v1/search/autocomplete`): categories (with counts) that match what is typed,
  title completions, and places. The website's search fields become an accessible combobox (ARIA 1.2,
  keyboard, debounced), with the visitor's recent searches kept in their browser. Without JavaScript the
  fields are plain forms, as before.
- **Measured relevance:** a judgement list (`services/search/test/relevance/judgements.json`: query,
  country, what the top results must be) runs in the integration tests against the demo data in a real
  OpenSearch. It reports precision at 5 and the zero-result rate and fails below the recorded floors, so a
  change that makes search worse cannot pass the gates.

## Alternatives considered

- **Semantic (vector) search with an embedding model:** the strongest answer for meaning, but it needs a
  model running next to the stack, and Phase 4 is on hold for exactly that reason. The lexicon and the
  judgement list stay useful when it comes: the judgements measure it, and the understood filters combine
  with it.
- **Hard-coded synonyms in the search service:** quick, but the words belong with the taxonomy they
  describe, where a new category brings its own words.
- **Categories as a ranking boost instead of a filter:** fewer surprises, but `car` would still show toy
  cars a few places down. A removable filter, shown as a chip, is clearer.

## Consequences

- Index version 6 adds the language subfields and the synonym analyzers; copying from version 5 is
  enough (no topic re-read).
- The lexicon's Somali words need a native speaker's review, like the category names (ADR-0040).
- The app gets query understanding at once (it is in the API); its autocomplete follows the website.
- Synonym changes need an index version bump (the synonyms are in the index settings).
