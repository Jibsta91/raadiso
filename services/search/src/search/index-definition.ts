import { ALL_ATTRIBUTES, SYNONYMS } from '@raadi/catalog';

/**
 * The listings index. Bump INDEX_VERSION when the mapping changes: on start
 * the service creates the new index, copies the documents from the old one
 * (through MIGRATE_SCRIPT) and moves the alias (SearchIndex.ensureIndex). Fields
 * that are not in the stored documents need a re-read of the topic
 * (docs/runbooks/event-pipeline.md).
 */
export const INDEX_VERSION = 8;

/**
 * Painless script applied while copying documents from an older index: version 5 (ADR-0040) added the
 * country, money in minor units and the region; version 7 (ADR-0042) adds quality, computed here from
 * the photos and the description (details count as half filled). Everything indexed before it is Norwegian, in kroner.
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
if (ctx._source.quality == null) {
  int photos = ctx._source.imageIds == null ? 0 : ctx._source.imageIds.size();
  int text = ctx._source.description == null ? 0 : ctx._source.description.trim().length();
  ctx._source.imageCount = photos;
  ctx._source.quality = Math.round((0.5 * Math.min(photos, 4) / 4.0 + 0.25 * Math.min(text, 400) / 400.0 + 0.125) * 100) / 100.0;
}
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
        // The same with the lexicon's synonyms, at search time only (ADR-0041).
        nb_search: {
          type: 'custom',
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'nb_synonyms',
            'norwegian_stop',
            'norwegian_stemmer',
            'asciifolding',
          ],
        },
        // English: light stemming ("phones" finds "phone"), possessives and stop words removed.
        en_text: {
          type: 'custom',
          tokenizer: 'standard',
          filter: [
            'english_possessive',
            'lowercase',
            'english_stop',
            'asciifolding',
            'english_stemmer',
          ],
        },
        en_search: {
          type: 'custom',
          tokenizer: 'standard',
          filter: [
            'english_possessive',
            'lowercase',
            'en_synonyms',
            'english_stop',
            'asciifolding',
            'english_stemmer',
          ],
        },
        // Somali: no stemmer exists, so whole words, folded, with the lexicon's synonyms.
        so_text: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'somali_stop'],
        },
        so_search: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'so_synonyms', 'somali_stop'],
        },
      },
      filter: {
        norwegian_stop: { type: 'stop', stopwords: '_norwegian_' },
        norwegian_stemmer: { type: 'stemmer', language: 'light_norwegian' },
        prefix_ngrams: { type: 'edge_ngram', min_gram: 2, max_gram: 15 },
        suffix_ngrams: { type: 'edge_ngram', min_gram: 4, max_gram: 20, preserve_original: true },
        english_stop: { type: 'stop', stopwords: '_english_' },
        english_stemmer: { type: 'stemmer', language: 'light_english' },
        english_possessive: { type: 'stemmer', language: 'possessive_english' },
        // Words that only connect others in Somali listings ("and", "of", "is", "for sale").
        somali_stop: {
          type: 'stop',
          stopwords: ['iyo', 'ah', 'oo', 'ee', 'ka', 'ku', 'la', 'u', 'waa'],
        },
        en_synonyms: { type: 'synonym_graph', lenient: true, synonyms: [...(SYNONYMS.en ?? [])] },
        so_synonyms: { type: 'synonym_graph', lenient: true, synonyms: [...(SYNONYMS.so ?? [])] },
        nb_synonyms: { type: 'synonym_graph', lenient: true, synonyms: [...(SYNONYMS.nb ?? [])] },
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
        search_analyzer: 'nb_search',
        fields: {
          std: { type: 'text', analyzer: 'standard' },
          en: { type: 'text', analyzer: 'en_text', search_analyzer: 'en_search' },
          so: { type: 'text', analyzer: 'so_text', search_analyzer: 'so_search' },
          prefix: { type: 'text', analyzer: 'nb_prefix', search_analyzer: 'standard' },
          suffix: { type: 'text', analyzer: 'nb_suffix', search_analyzer: 'nb_plain' },
          // Exact titles for suggestions (shown as typed).
          raw: { type: 'keyword', ignore_above: 256 },
        },
      },
      description: {
        type: 'text',
        analyzer: 'nb_text',
        search_analyzer: 'nb_search',
        fields: {
          suffix: { type: 'text', analyzer: 'nb_suffix', search_analyzer: 'nb_plain' },
          en: { type: 'text', analyzer: 'en_text', search_analyzer: 'en_search' },
          so: { type: 'text', analyzer: 'so_text', search_analyzer: 'so_search' },
        },
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
      imageCount: { type: 'integer' },
      /** 0–1, what the seller gave buyers (ADR-0042). */
      quality: { type: 'float' },
      publishedAt: { type: 'date' },
      updatedAt: { type: 'date' },
      promotedUntil: { type: 'date' },
      /** The last price drop (ADR-0044). */
      previousPriceMinor: { type: 'long' },
      priceDroppedAt: { type: 'date' },
    },
  },
};
