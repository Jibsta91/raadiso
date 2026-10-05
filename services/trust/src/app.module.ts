import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  createPgPool,
  HealthController,
  HealthRegistry,
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
import type { AppConfig } from './config.js';
import { Lifecycle } from './lifecycle.js';
import { BankIdClient } from './trust/bankid.js';
import { ListingsClient } from './trust/listings.client.js';
import { TrustAdminController, TrustAdminService } from './trust/admin.js';
import { TrustController } from './trust/trust.controller.js';
import { TrustRepository } from './trust/trust.repository.js';
import { TrustService } from './trust/trust.service.js';
import { TrustWorkers } from './trust/workers.js';
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
            ...loggerOptions('trust', env.LOG_LEVEL),
            genReqId: requestId,
            autoLogging: { ignore: isHealthProbe },
            serializers: {
              // No query strings in logs: the verification callback carries a code and state.
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url.split('?')[0],
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
          },
        }),
        // Per-client-IP limits on top of the gateway's (writing reviews has its own, lower limit).
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
          skipIf: (ctx) => ctx.getClass() === HealthController,
        }),
      ],
      controllers: [TrustController, TrustAdminController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: PG_POOL, useFactory: () => createPgPool(env, secrets.db_password, 'trust') },
        { provide: JwtVerifier, useValue: keycloakVerifier(env) },
        { provide: HealthRegistry, useValue: new HealthRegistry() },
        BankIdClient,
        { provide: ListingsClient, useValue: new ListingsClient(env.LISTINGS_URL) },
        TrustRepository,
        TrustService,
        TrustAdminService,
        TrustWorkers,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
