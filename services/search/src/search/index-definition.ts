import { ALL_ATTRIBUTES } from '@raadi/catalog';

/**
 * The listings index. Bump INDEX_VERSION when the mapping changes: on start
 * the service creates the new index, copies the documents from the old one
 * (through MIGRATE_SCRIPT) and moves the alias (SearchIndex.ensureIndex). Fields
 * that are not in the stored documents need a re-read of the topic
 * (docs/runbooks/event-pipeline.md).
 */
export const INDEX_VERSION = 5;

/**
 * Painless script applied while copying documents from an older index: version 5 (ADR-0040) adds the
 * country, money in minor units and the region. Everything indexed before it is Norwegian, in kroner.
 * Idempotent: documents that already have the new fields pass unchanged.
 */
export const MIGRATE_SCRIPT = `
if (ctx._source.country == null) { ctx._source.country = 'NO'; }
if (ctx._source.containsKey('priceNok')) {
  def kroner = ctx._source.remove('priceNok');
  if (kroner == null) { ctx._source.priceMinor = null; ctx._source.currency = null; }
  else { ctx._source.priceMinor = ((Number) kroner).longValue() * 100L; ctx._source.currency = 'NOK'; }
}
if (ctx._source.containsKey('county')) { ctx._source.region = ctx._source.remove('county'); }
`;

/** The attributes' mapping, generated from every country's taxonomy (one kind per key). */
const attributeMapping = Object.fromEntries(
  [...ALL_ATTRIBUTES.values()].map((a) => [
    a.key,
    a.kind === 'number'
      ? { type: 'integer' }
      : a.kind === 'text'
        ? { type: 'keyword', normalizer: 'lower' }
        : { type: 'keyword' },
  ]),
);

export const indexBody = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    refresh_interval: '1s',
    analysis: {
      normalizer: { lower: { type: 'custom', filter: ['lowercase', 'asciifolding'] } },
      analyzer: {
        // Norwegian stemming ("skiene" matches "ski"), ASCII folding so "ostfold" finds "Østfold".
        nb_text: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'norwegian_stop', 'norwegian_stemmer', 'asciifolding'],
        },
        // Every ending of every word, from four letters: Norwegian compounds put the main word last, so
        // "sykkel" finds "Terrengsykkel" and "Elsykkel" (searched with nb_plain, without stemming).
        nb_suffix: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'reverse', 'suffix_ngrams', 'reverse'],
        },
        nb_plain: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding'],
        },
        // Search-as-you-type prefixes for suggestions.
        nb_prefix: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'prefix_ngrams'],
        },
      },
      filter: {
        norwegian_stop: { type: 'stop', stopwords: '_norwegian_' },
        norwegian_stemmer: { type: 'stemmer', language: 'light_norwegian' },
        prefix_ngrams: { type: 'edge_ngram', min_gram: 2, max_gram: 15 },
        suffix_ngrams: { type: 'edge_ngram', min_gram: 4, max_gram: 20, preserve_original: true },
      },
    },
  },
  mappings: {
    dynamic: 'strict',
    properties: {
      id: { type: 'keyword' },
      ownerId: { type: 'keyword' },
      status: { type: 'keyword' },
      /** The marketplace country (ADR-0040); every query filters on it. */
      country: { type: 'keyword' },
      category: { type: 'keyword' },
      subcategory: { type: 'keyword' },
      title: {
        type: 'text',
        analyzer: 'nb_text',
        fields: {
          std: { type: 'text', analyzer: 'standard' },
          prefix: { type: 'text', analyzer: 'nb_prefix', search_analyzer: 'standard' },
          suffix: { type: 'text', analyzer: 'nb_suffix', search_analyzer: 'nb_plain' },
          // Exact titles for suggestions (shown as typed).
          raw: { type: 'keyword', ignore_above: 256 },
        },
      },
      description: {
        type: 'text',
        analyzer: 'nb_text',
        fields: { suffix: { type: 'text', analyzer: 'nb_suffix', search_analyzer: 'nb_plain' } },
      },
      /** Minor units of `currency` (the country's), absent when there is no price. */
      priceMinor: { type: 'long' },
      currency: { type: 'keyword' },
      attributes: {
        type: 'object',
        // Keys outside the taxonomy are kept in _source but not indexed.
        dynamic: false,
        properties: attributeMapping,
      },
      placeId: { type: 'keyword' },
      placeName: { type: 'keyword' },
      region: { type: 'keyword' },
      location: { type: 'geo_point' },
      imageIds: { type: 'keyword', index: false },
      publishedAt: { type: 'date' },
      updatedAt: { type: 'date' },
      promotedUntil: { type: 'date' },
    },
  },
};
