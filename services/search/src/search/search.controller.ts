import { Controller, Get, Query, Res } from '@nestjs/common';
import { COUNTRY_CODES } from '@raadi/catalog';
import { Public, ZodValidationPipe } from '@raadi/service-kit';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { type SearchParams, searchParamsSchema } from './query.js';
import { type SearchResult, SearchService } from './search.service.js';

const suggestSchema = z
  .object({ q: z.string().trim().min(2).max(60), country: z.enum(COUNTRY_CODES).optional() })
  .strict();

/** Public search API: anonymous browsing is the core of a marketplace. */
@Public()
@Controller('api/v1/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('listings')
  async listings(
    @Query(new ZodValidationPipe(searchParamsSchema)) params: SearchParams,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SearchResult> {
    void reply.header('cache-control', 'public, max-age=15');
    return this.search.search(params);
  }

  @Get('suggest')
  async suggest(
    @Query(new ZodValidationPipe(suggestSchema)) { q, country }: z.infer<typeof suggestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ suggestions: string[] }> {
    void reply.header('cache-control', 'public, max-age=60');
    return { suggestions: await this.search.suggest(q, country) };
  }
}
