import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  HealthRegistry,
  installGracefulShutdown,
  noStoreByDefault,
  requestId,
  startEventTableJanitor,
} from '@raadi/service-kit';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { PG_POOL } from './tokens.js';
import { loadAppConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const cfg = await loadAppConfig();
  const adapter = new FastifyAdapter({
    // Only Traefik and internal services reach this service.
    trustProxy: true,
    // Only small JSON bodies (a review is at most 1000 characters).
    bodyLimit: 16 * 1024,
    genReqId: requestId,
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(cfg), adapter, {
    bufferLogs: true,
    logger: new ConsoleLogger({ json: true, colors: false }),
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  noStoreByDefault(app);
  installGracefulShutdown(app, app.get(HealthRegistry), {
    drainMs: cfg.env.SHUTDOWN_DRAIN_MS,
    log: (msg) => logger.log(msg),
  });
  // Old outbox and processed_events rows: no endless growth, no stale personal data.
  startEventTableJanitor(app.get(PG_POOL), { log: (obj, msg) => logger.log(obj, msg) });
  await app.listen(cfg.env.PORT, '0.0.0.0');
  logger.log(`trust listening on :${cfg.env.PORT}`);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      service: 'trust',
      msg: 'startup failed',
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    })}\n`,
  );
  process.exit(1);
});
