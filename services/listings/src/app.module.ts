import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  createPgPool,
  FgaClient,
  HealthController,
  HealthRegistry,
  imgproxySigner,
  isHealthProbe,
  JwtAuthGuard,
  JwtVerifier,
  keycloakVerifier,
  loggerOptions,
  OpaClient,
  ProblemDetailsFilter,
  requestId,
  RouteSpanInterceptor,
} from '@raadi/service-kit';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from './config.js';
import { PromotionsConsumer } from './listings/promotions.consumer.js';
import { Lifecycle } from './lifecycle.js';
import { InternalListingsController } from './listings/internal.controller.js';
import { ListingsController } from './listings/listings.controller.js';
import { ListingsRepository } from './listings/listings.repository.js';
import { ListingsService, SIGNER } from './listings/listings.service.js';
import { SavedClient } from './listings/saved.client.js';
import { ReportsController, ReportsService } from './listings/reports.js';
import { ListingsAdminController, ListingsAdminService } from './listings/admin.js';
import { APP_CONFIG, PG_POOL } from './tokens.js';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    const { env, secrets } = cfg;
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...loggerOptions('listings', env.LOG_LEVEL),
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
        // Per-client-IP limits on top of the gateway's; writes are stricter (controller).
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
          skipIf: (ctx) => ctx.getClass() === HealthController,
        }),
      ],
      controllers: [
        ListingsController,
        ReportsController,
        InternalListingsController,
        ListingsAdminController,
        HealthController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: PG_POOL, useFactory: () => createPgPool(env, secrets.db_password, 'listings') },
        { provide: JwtVerifier, useValue: keycloakVerifier(env) },
        { provide: HealthRegistry, useValue: new HealthRegistry() },
        {
          provide: FgaClient,
          useValue: new FgaClient({ url: env.OPENFGA_URL, apiKey: secrets.fga_key }),
        },
        {
          provide: OpaClient,
          useValue: new OpaClient({ url: env.OPA_URL, token: secrets.opa_token }),
        },
        { provide: SavedClient, useValue: new SavedClient(env.SAVED_URL) },
        {
          provide: SIGNER,
          useValue: imgproxySigner(secrets['imgproxy.key'], secrets['imgproxy.salt']),
        },
        ListingsRepository,
        ListingsService,
        ReportsService,
        ListingsAdminService,
        PromotionsConsumer,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
