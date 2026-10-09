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
import { ListingsClient } from './payments/listings.client.js';
import { PaymentsAdminController, PaymentsAdminService } from './payments/admin.js';
import { PaymentsController } from './payments/payments.controller.js';
import { PaymentsRepository } from './payments/payments.repository.js';
import { PaymentsService } from './payments/payments.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payments/providers/provider.js';
import { StripeProvider } from './payments/providers/stripe.js';
import { NoProvider } from './payments/providers/none.js';
import { VippsProvider } from './payments/providers/vipps.js';
import { PaymentWorkers } from './payments/workers.js';
import { APP_CONFIG, PG_POOL } from './tokens.js';

function provider({ env, secrets }: AppConfig): PaymentProvider {
  if (env.PAYMENTS_PROVIDER === 'none') return new NoProvider();
  if (env.PAYMENTS_PROVIDER === 'stripe') {
    return new StripeProvider({
      baseUrl: env.STRIPE_BASE_URL,
      secretKey: secrets.stripe_secret_key!,
      webhookSecret: secrets.stripe_webhook_secret!,
    });
  }
  return new VippsProvider({
    baseUrl: env.VIPPS_BASE_URL,
    clientId: env.VIPPS_CLIENT_ID,
    clientSecret: secrets.vipps_client_secret!,
    subscriptionKey: secrets.vipps_subscription_key!,
    merchantSerialNumber: env.VIPPS_MSN,
    webhookSecret: secrets.vipps_webhook_secret!,
  });
}

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    const { env, secrets } = cfg;
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...loggerOptions('payments', env.LOG_LEVEL),
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
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
          skipIf: (ctx) => ctx.getClass() === HealthController,
        }),
      ],
      controllers: [PaymentsController, PaymentsAdminController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: PG_POOL, useFactory: () => createPgPool(env, secrets.db_password, 'payments') },
        { provide: JwtVerifier, useValue: keycloakVerifier(env) },
        { provide: HealthRegistry, useValue: new HealthRegistry() },
        { provide: PAYMENT_PROVIDER, useValue: provider(cfg) },
        { provide: ListingsClient, useValue: new ListingsClient(env.LISTINGS_URL) },
        PaymentsRepository,
        PaymentsService,
        PaymentsAdminService,
        PaymentWorkers,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
