import {
  Consumer,
  type Message,
  MessagesStreamFallbackModes,
  MessagesStreamModes,
  Producer,
  stringDeserializers,
  stringSerializers,
  type MessagesStream,
} from '@platformatic/kafka';
import {
  context,
  metrics,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

/**
 * Throw from a handler when an event can never succeed (invalid contract,
 * reference to something that cannot exist). The event goes to the
 * dead-letter topic and processing continues. A bug (see `isBug`) goes there
 * after a few attempts. Any other error is treated as transient and retried
 * with backoff, without skipping the event.
 */
export class PermanentEventError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentEventError';
  }
}

export interface ReceivedEvent {
  topic: string;
  partition: number;
  offset: bigint;
  key: string | undefined;
  headers: Record<string, string>;
  /** Parsed JSON value (a CloudEvent for outbox topics). */
  value: unknown;
}

export interface EventConsumerOptions {
  clientId: string;
  groupId: string;
  brokers: string[];
  username: string;
  password: string;
  topics: string[];
  deadLetterTopic: string;
  handle: (event: ReceivedEvent) => Promise<void>;
  log: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
    error(obj: object, msg: string): void;
  };
  /** Backoff cap for transient failures (default 30s). */
  maxBackoffMs?: number;
  /** Attempts before an event that hits a bug goes to the dead-letter topic (default 5). */
  maxBugAttempts?: number;
}

/** SQLSTATE classes that retrying cannot fix: data exceptions, constraint violations, bad SQL. */
const PERMANENT_SQL = /^(22|23|42)[0-9A-Z]{3}$/;

/**
 * Errors that come from the code or the data, not from a dependency being down: retrying the same
 * event will fail the same way. Before, they were retried forever and stopped the partition (every
 * later event waited behind the broken one). A dependency that is down (connection errors, 5xx,
 * timeouts, an open circuit) is never a bug: those events wait until it is back.
 */
export function isBug(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // fetch() reports a network failure as a TypeError with this message; that is a dependency, not a bug.
  if (error instanceof TypeError && error.message === 'fetch failed') return false;
  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError ||
    error instanceof RangeError ||
    error.name === 'ZodError'
  ) {
    return true;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && PERMANENT_SQL.test(code);
}

const meter = metrics.getMeter('raadi-events');
const consumed = meter.createCounter('raadi.events.consumed', {
  description: 'Events processed by consumers, by topic and outcome',
});
const duration = meter.createHistogram('raadi.events.processing.duration', {
  description: 'Time to process one event, including retries',
  unit: 's',
});
const tracer = trace.getTracer('raadi-events');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * At-least-once Kafka consumer for outbox topics. Messages are handled in
 * order per partition and the offset is committed after the handler succeeds,
 * so handlers must be idempotent (dedupe on the event id or use versions).
 */
export class EventConsumer {
  private readonly consumer: Consumer<string, string, string, string>;
  private readonly dlq: Producer<string, string, string, string>;
  private stream?: MessagesStream<string, string, string, string>;
  private stopping = false;
  private loop?: Promise<void>;
  private lastError?: string;

  constructor(private readonly opts: EventConsumerOptions) {
    const sasl = {
      mechanism: 'SCRAM-SHA-512' as const,
      username: opts.username,
      password: opts.password,
    };
    this.consumer = new Consumer({
      clientId: opts.clientId,
      groupId: opts.groupId,
      bootstrapBrokers: opts.brokers,
      sasl,
      deserializers: stringDeserializers,
      autocommit: false,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      retries: 10,
      retryDelay: 1_000,
    });
    this.dlq = new Producer({
      clientId: `${opts.clientId}-dlq`,
      bootstrapBrokers: opts.brokers,
      sasl,
      serializers: stringSerializers,
      retries: 5,
    });
  }

  async start(): Promise<void> {
    this.stream = await this.consumer.consume({
      topics: this.opts.topics,
      mode: MessagesStreamModes.COMMITTED,
      fallbackMode: MessagesStreamFallbackModes.EARLIEST,
      autocommit: false,
    });
    this.loop = this.run(this.stream).catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.opts.log.error({ err: error }, 'event consumer stopped');
    });
    this.opts.log.info(
      { topics: this.opts.topics, groupId: this.opts.groupId },
      'event consumer started',
    );
  }

  /** Readiness: the consumer is connected and its loop has not died. */
  healthy(): void {
    if (this.lastError) throw new Error(`consumer stopped: ${this.lastError}`);
    if (!this.stream?.isConnected()) throw new Error('consumer not connected');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.stream?.close().catch(() => undefined);
    await this.loop;
    await Promise.allSettled([this.consumer.close(), this.dlq.close()]);
  }

  private async run(stream: MessagesStream<string, string, string, string>): Promise<void> {
    for await (const message of stream) {
      if (this.stopping) break;
      await this.process(message);
      await message.commit();
    }
  }

  private async process(message: Message<string, string, string, string>): Promise<void> {
    const headers = Object.fromEntries(message.headers);
    const parent = propagation.extract(context.active(), headers);
    const started = performance.now();
    await tracer.startActiveSpan(
      `process ${message.topic}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'kafka',
          'messaging.operation.type': 'process',
          'messaging.destination.name': message.topic,
          'messaging.consumer.group.name': this.opts.groupId,
          'messaging.kafka.offset': Number(message.offset),
          'messaging.destination.partition.id': String(message.partition),
          'messaging.message.id': headers.id ?? '',
          'cloudevents.event_type': headers.ce_type ?? '',
        },
      },
      parent,
      async (span) => {
        const outcome = await this.processWithRetry(message, headers, span);
        consumed.add(1, { topic: message.topic, outcome });
        duration.record((performance.now() - started) / 1000, { topic: message.topic, outcome });
        span.setAttribute('raadi.outcome', outcome);
        span.end();
      },
    );
  }

  private async processWithRetry(
    message: Message<string, string, string, string>,
    headers: Record<string, string>,
    span: Span,
  ): Promise<'ok' | 'dead_lettered'> {
    const event: ReceivedEvent = {
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
      key: message.key ?? undefined,
      headers,
      value: undefined,
    };
    for (let attempt = 0; ; attempt++) {
      try {
        try {
          event.value = JSON.parse(message.value);
        } catch (error) {
          throw new PermanentEventError('message value is not JSON', { cause: error });
        }
        await this.opts.handle(event);
        return 'ok';
      } catch (error) {
        const bugGivesUp = isBug(error) && attempt + 1 >= (this.opts.maxBugAttempts ?? 5);
        if (error instanceof PermanentEventError || bugGivesUp) {
          const cause = error as Error;
          span.recordException(cause);
          span.setStatus({ code: SpanStatusCode.ERROR, message: cause.message });
          await this.deadLetter(message, headers, cause);
          return 'dead_lettered';
        }
        if (this.stopping) throw error;
        const delay = Math.min(this.opts.maxBackoffMs ?? 30_000, 250 * 2 ** Math.min(attempt, 8));
        this.opts.log.warn(
          {
            err: error,
            topic: message.topic,
            offset: String(message.offset),
            attempt: attempt + 1,
            delayMs: delay,
          },
          'event processing failed, retrying',
        );
        await sleep(delay);
      }
    }
  }

  private async deadLetter(
    message: Message<string, string, string, string>,
    headers: Record<string, string>,
    error: Error,
  ): Promise<void> {
    this.opts.log.error(
      { err: error, topic: message.topic, offset: String(message.offset), eventId: headers.id },
      'event dead-lettered',
    );
    await this.dlq.send({
      messages: [
        {
          topic: this.opts.deadLetterTopic,
          key: message.key ?? undefined,
          value: message.value,
          headers: {
            ...headers,
            'dlq.source.topic': message.topic,
            'dlq.source.partition': String(message.partition),
            'dlq.source.offset': String(message.offset),
            'dlq.consumer.group': this.opts.groupId,
            'dlq.error': error.message.slice(0, 500),
          },
        },
      ],
    });
  }
}
