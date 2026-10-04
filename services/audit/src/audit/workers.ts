import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { topicFor } from '@raadi/events';
import { EventConsumer } from '@raadi/service-kit/kafka';
import type { AppConfig } from '../config.js';
import { APP_CONFIG } from '../tokens.js';
import { AuditService } from './audit.js';

/** The consumer (group "audit") that records every service's audit events. */
@Injectable()
export class AuditWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AuditWorkers');
  readonly consumer: EventConsumer;

  constructor(audit: AuditService, @Inject(APP_CONFIG) cfg: AppConfig) {
    this.consumer = new EventConsumer({
      clientId: 'audit',
      groupId: 'audit',
      brokers: cfg.env.KAFKA_BROKERS.split(','),
      username: cfg.env.KAFKA_USERNAME,
      password: cfg.secrets.kafka_password,
      topics: [topicFor('audit')],
      deadLetterTopic: 'raadi.dlq',
      handle: (event) => audit.onEvent(event),
      log: {
        info: (o, m) => this.logger.log(o, m),
        warn: (o, m) => this.logger.warn(o, m),
        error: (o, m) => this.logger.error(o, m),
      },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.stop();
  }
}
