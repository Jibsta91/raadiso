import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  HealthRegistry,
  installGracefulShutdown,
  noStoreByDefault,
  requestId,
} from '@raadi/service-kit';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadAppConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const cfg = await loadAppConfig();
  const adapter = new FastifyAdapter({
    // Only Traefik and internal services reach this service.
    trustProxy: true,
    // Small JSON bodies (orders, provider webhooks).
    bodyLimit: 16 * 1024,
    genReqId: requestId,
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(cfg), adapter, {
    bufferLogs: true,
    // Webhook signatures are computed over the exact bytes received.
    rawBody: true,
    logger: new ConsoleLogger({ json: true, colors: false }),
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  noStoreByDefault(app);
  installGracefulShutdown(app, app.get(HealthRegistry), {
    drainMs: cfg.env.SHUTDOWN_DRAIN_MS,
    log: (msg) => logger.log(msg),
  });
  await app.listen(cfg.env.PORT, '0.0.0.0');
  logger.log(`payments listening on :${cfg.env.PORT}`);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      service: 'payments',
      msg: 'startup failed',
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    })}\n`,
  );
  process.exit(1);
});
