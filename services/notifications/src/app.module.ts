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
import { NotificationsAdminController } from './notifications/admin.js';
import { createTransport } from 'nodemailer';
import type { AppConfig } from './config.js';
import { Lifecycle } from './lifecycle.js';
import { UserDirectory } from './notifications/directory.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsRepository } from './notifications/notifications.repository.js';
import { MAILER, NotificationsService, PUSHER } from './notifications/notifications.service.js';
import { PushClient } from './notifications/push.js';
import { NotificationWorkers } from './notifications/workers.js';
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
            ...loggerOptions('notifications', env.LOG_LEVEL),
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
        // Per-client-IP limits on top of the gateway's.
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
          skipIf: (ctx) => ctx.getClass() === HealthController,
        }),
      ],
      controllers: [NotificationsController, NotificationsAdminController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        {
          provide: PG_POOL,
          useFactory: () => createPgPool(env, secrets.db_password, 'notifications'),
        },
        { provide: JwtVerifier, useValue: keycloakVerifier(env) },
        { provide: HealthRegistry, useValue: new HealthRegistry() },
        {
          provide: UserDirectory,
          useValue: new UserDirectory({
            keycloakUrl: env.KEYCLOAK_INTERNAL_URL,
            realm: env.KEYCLOAK_REALM,
            clientId: env.KEYCLOAK_CLIENT_ID,
            clientSecret: secrets.keycloak_client_secret,
          }),
        },
        {
          provide: MAILER,
          useValue: createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            ...(env.SMTP_USER
              ? { auth: { user: env.SMTP_USER, pass: secrets.smtp_password } }
              : {}),
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
          }),
        },
        {
          provide: PUSHER,
          useValue: new PushClient({ url: env.PUSH_URL, accessToken: secrets.push_access_token }),
        },
        NotificationsRepository,
        NotificationsService,
        NotificationWorkers,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
