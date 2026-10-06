/**
 * The listings index. Bump INDEX_VERSION when the mapping changes: on start
 * the service creates the new index, copies the documents from the old one
 * and moves the alias (SearchIndex.ensureIndex). Fields that are not in the
 * stored documents need a re-read of the topic (docs/runbooks/event-pipeline.md).
 */
export const INDEX_VERSION = 4;

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
      priceNok: { type: 'long' },
      attributes: {
        type: 'object',
        dynamic: true,
        properties: {
          condition: { type: 'keyword' },
          fuel: { type: 'keyword' },
          gearbox: { type: 'keyword' },
          propertyType: { type: 'keyword' },
          employmentType: { type: 'keyword' },
          bodyType: { type: 'keyword' },
          drivetrain: { type: 'keyword' },
          ownership: { type: 'keyword' },
          make: { type: 'keyword', normalizer: 'lower' },
          model: { type: 'keyword', normalizer: 'lower' },
          employer: { type: 'keyword', normalizer: 'lower' },
          year: { type: 'integer' },
          mileageKm: { type: 'integer' },
          areaM2: { type: 'integer' },
          bedrooms: { type: 'integer' },
          guests: { type: 'integer' },
        },
      },
      placeId: { type: 'keyword' },
      placeName: { type: 'keyword' },
      county: { type: 'keyword' },
      location: { type: 'geo_point' },
      imageIds: { type: 'keyword', index: false },
      publishedAt: { type: 'date' },
      updatedAt: { type: 'date' },
      promotedUntil: { type: 'date' },
    },
  },
} as const;
