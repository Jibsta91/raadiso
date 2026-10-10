import { type DynamicModule, Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
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
import type { AppConfig } from './config.js';
import { Lifecycle } from './lifecycle.js';
import { SearchController } from './search/search.controller.js';
import { SearchAdminController } from './search/admin.js';
import { SearchIndex } from './search/search.index.js';
import { ResultCache } from './search/search.cache.js';
import {
  DEFAULT_COUNTRY,
  PRICE_INSIGHT,
  SEARCH_CACHE,
  SearchService,
  SIGNER,
} from './search/search.service.js';
import { APP_CONFIG } from './tokens.js';
import { Indexer } from './workers.js';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    const { env, secrets } = cfg;
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...loggerOptions('search', env.LOG_LEVEL),
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
          throttlers: [{ name: 'default', ttl: 60_000, limit: 1200 }],
          skipIf: (ctx) => ctx.getClass() === HealthController,
        }),
      ],
      controllers: [SearchController, SearchAdminController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: DEFAULT_COUNTRY, useValue: env.DEFAULT_COUNTRY },
        { provide: PRICE_INSIGHT, useValue: env.PRICE_INSIGHT },
        {
          provide: SEARCH_CACHE,
          useValue: new ResultCache(
            {
              ttlMs: env.SEARCH_CACHE_TTL_MS,
              staleMs: env.SEARCH_CACHE_STALE_MS,
              maxEntries: env.SEARCH_CACHE_MAX_ENTRIES,
              // OpenSearch's refresh interval (1 s, index-definition.ts) and a margin.
              settleMs: 1_500,
            },
            (error) =>
              // The error's name only: OpenSearch errors can quote the query, which is what people typed.
              new Logger('SearchCache').warn(
                { error: error instanceof Error ? error.name : 'unknown' },
                'background refresh failed',
              ),
          ),
        },
        { provide: JwtVerifier, useValue: keycloakVerifier(env) },
        { provide: HealthRegistry, useValue: new HealthRegistry() },
        {
          provide: SIGNER,
          useValue: imgproxySigner(secrets['imgproxy.key'], secrets['imgproxy.salt']),
        },
        {
          provide: SearchIndex,
          useValue: new SearchIndex(
            env.OPENSEARCH_URL,
            env.OPENSEARCH_USERNAME,
            secrets.opensearch_password,
            env.INDEX_ALIAS,
          ),
        },
        SearchService,
        Indexer,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
