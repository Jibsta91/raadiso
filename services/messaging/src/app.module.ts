import { type DynamicModule, Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  createPgPool,
  HealthController,
  HealthRegistry,
  imgproxySigner,
  isHealthProbe,
  JwtAuthGuard,
  JwtVerifier,
  keycloakVerifier,
  loggerOptions,
  ProblemDetailsFilter,
  requestId,
  RouteSpanInterceptor,
} from '@raadi/service-kit';
import { LoggerModule } from 'nestjs-pino';
import { MessagingAdminController } from './messaging/admin.js';
import type { AppConfig } from './config.js';
import { Lifecycle } from './lifecycle.js';
import { ListingsClient } from './messaging/listings.client.js';
import { MessagingController } from './messaging/messaging.controller.js';
import { MessagingRepository } from './messaging/messaging.repository.js';
import { MessagingService, SIGNER } from './messaging/messaging.service.js';
import { RealtimeHub } from './messaging/realtime.js';
import { APP_CONFIG, PG_POOL } from './tokens.js';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    const { env, secrets } = cfg;
    const verifier = keycloakVerifier(env);
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...loggerOptions('messaging', env.LOG_LEVEL),
            genReqId: requestId,
            autoLogging: { ignore: isHealthProbe },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url.split('?')[0],
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
          },
        }),
        // Per-client-IP limits on top of the gateway's; sending is stricter (controller).
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
          skipIf: (ctx) => ctx.getClass() === HealthController,
        }),
      ],
      controllers: [MessagingController, MessagingAdminController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: PG_POOL, useFactory: () => createPgPool(env, secrets.db_password, 'messaging') },
        { provide: JwtVerifier, useValue: verifier },
        { provide: HealthRegistry, useValue: new HealthRegistry() },
        { provide: ListingsClient, useValue: new ListingsClient(env.LISTINGS_URL) },
        {
          provide: RealtimeHub,
          useValue: new RealtimeHub({
            verifier,
            origin: new URL(env.PUBLIC_BASE_URL).origin,
            valkey: {
              host: env.VALKEY_HOST,
              port: env.VALKEY_PORT,
              username: env.VALKEY_USER,
              password: secrets.valkey_password,
            },
            log: new Logger('RealtimeHub'),
          }),
        },
        {
          provide: SIGNER,
          useValue: imgproxySigner(secrets['imgproxy.key'], secrets['imgproxy.salt']),
        },
        MessagingRepository,
        MessagingService,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
