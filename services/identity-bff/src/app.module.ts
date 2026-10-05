import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  HealthController,
  HealthRegistry,
  isHealthProbe,
  JwtAuthGuard,
  JwtVerifier,
  loggerOptions,
  ProblemDetailsFilter,
  requestId,
  RouteSpanInterceptor,
} from '@raadi/service-kit';
import { LoggerModule } from 'nestjs-pino';
import { AuthController } from './auth/auth.controller.js';
import { OidcService } from './auth/oidc.service.js';
import { SessionStore } from './auth/session.store.js';
import type { AppConfig } from './config.js';
import { createPool, createValkey, type Valkey } from './infra/clients.js';
import { ValkeyThrottlerStorage } from './infra/throttler-storage.js';
import { Lifecycle } from './lifecycle.js';
import { MeController } from './me/me.controller.js';
import { AccountClient, SecurityController } from './me/security.controller.js';
import { KeycloakAdmin } from './staff/keycloak-admin.js';
import { KEYCLOAK_ADMIN, UserAdminController, UserAdminService } from './staff/users.admin.js';
import { APP_CONFIG, PG_POOL, VALKEY } from './tokens.js';
import { UsersRepository } from './users/users.repository.js';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    const valkey = createValkey(cfg);
    // admin-bff only: the console's user administration (ADR-0030).
    const staff = cfg.env.STAFF_API
      ? {
          controllers: [UserAdminController],
          providers: [
            {
              provide: KEYCLOAK_ADMIN,
              useValue: new KeycloakAdmin({
                keycloakUrl: cfg.env.KEYCLOAK_INTERNAL_URL,
                realm: cfg.env.KEYCLOAK_REALM,
                clientId: cfg.env.KEYCLOAK_ADMIN_CLIENT_ID,
                clientSecret: cfg.secrets.keycloakClientSecret!,
              }),
            },
            UserAdminService,
          ],
        }
      : { controllers: [], providers: [] };
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...loggerOptions('identity-bff', cfg.env.LOG_LEVEL),
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
          throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
          storage: new ValkeyThrottlerStorage(valkey),
          skipIf: (ctx) => ctx.getClass() === HealthController,
        }),
      ],
      controllers: [
        AuthController,
        MeController,
        SecurityController,
        ...staff.controllers,
        HealthController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: VALKEY, useValue: valkey satisfies Valkey },
        { provide: PG_POOL, useFactory: () => createPool(cfg) },
        {
          provide: JwtVerifier,
          useValue: new JwtVerifier({
            issuer: cfg.issuer,
            jwksUrl: `${cfg.realmInternalUrl}/protocol/openid-connect/certs`,
            audience: cfg.env.API_AUDIENCE,
          }),
        },
        { provide: HealthRegistry, useValue: new HealthRegistry() },
        SessionStore,
        OidcService,
        UsersRepository,
        AccountClient,
        ...staff.providers,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
