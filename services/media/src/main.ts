import 'reflect-metadata';
import fastifyMultipart from '@fastify/multipart';
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
    // Uploads are multipart (capped per file below); allow the envelope around one image.
    bodyLimit: 11 * 1024 * 1024,
    genReqId: requestId,
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(cfg), adapter, {
    bufferLogs: true,
    logger: new ConsoleLogger({ json: true, colors: false }),
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // One file per request, streamed with a hard size cap (the gateway caps the body too).
  await app.register(fastifyMultipart as never, {
    limits: { fileSize: cfg.env.MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 50 },
  });
  noStoreByDefault(app);
  installGracefulShutdown(app, app.get(HealthRegistry), {
    drainMs: cfg.env.SHUTDOWN_DRAIN_MS,
    log: (msg) => logger.log(msg),
  });
  // Old outbox and processed_events rows: no endless growth, no stale personal data.
  startEventTableJanitor(app.get(PG_POOL), { log: (obj, msg) => logger.log(obj, msg) });
  await app.listen(cfg.env.PORT, '0.0.0.0');
  logger.log(`media listening on :${cfg.env.PORT}`);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      service: 'media',
      msg: 'startup failed',
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    })}\n`,
  );
  process.exit(1);
});
