import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
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
    // Only Traefik can reach this service; it sanitises X-Forwarded-* headers.
    trustProxy: true,
    bodyLimit: 64 * 1024,
    genReqId: requestId,
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(cfg), adapter, {
    bufferLogs: true,
    // JSON even before pino takes over, so bootstrap errors are machine-readable.
    logger: new ConsoleLogger({ json: true, colors: false }),
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  await app.register(fastifyCookie as never);
  noStoreByDefault(app);
  installGracefulShutdown(app, app.get(HealthRegistry), {
    drainMs: cfg.env.SHUTDOWN_DRAIN_MS,
    log: (msg) => logger.log(msg),
  });
  // Old outbox and processed_events rows: no endless growth, no stale personal data.
  startEventTableJanitor(app.get(PG_POOL), { log: (obj, msg) => logger.log(obj, msg) });

  await app.listen(cfg.env.PORT, '0.0.0.0');
  logger.log(`identity-bff listening on :${cfg.env.PORT}`);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      service: 'identity-bff',
      msg: 'startup failed',
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    })}\n`,
  );
  process.exit(1);
});
