export * from './contracts.js';
export * from './envelope.js';
export * from './json-schema.js';

/** Kafka topic per aggregate type (Debezium routes outbox rows by aggregate_type). */
export const topicFor = (
  aggregateType:
    | 'user'
    | 'listing'
    | 'media'
    | 'conversation'
    | 'review'
    | 'payment'
    | 'promotion'
    | 'alert'
    | 'audit',
) => `raadi.${aggregateType}.events`;
