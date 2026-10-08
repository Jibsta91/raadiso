import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ALL_ATTRIBUTES, COUNTRY_CODES, findPlace, isSubcategoryOf } from '@raadi/catalog';
import { Public, ZodValidationPipe } from '@raadi/service-kit';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { type SearchParams, searchParamsSchema } from './query.js';
import {
  type Autocomplete,
  type PriceInsight,
  type SearchResult,
  SearchService,
} from './search.service.js';
import type { PriceStats } from './price.js';

const suggestSchema = z
  .object({ q: z.string().trim().min(2).max(60), country: z.enum(COUNTRY_CODES).optional() })
  .strict();

const autocompleteSchema = z
  .object({ q: z.string().trim().min(1).max(60), country: z.enum(COUNTRY_CODES).optional() })
  .strict();

/** A draft listing's category, place and details, for the price guide (ADR-0043). */
const guideSchema = z
  .object({
    country: z.enum(COUNTRY_CODES),
    category: z.string().min(1).max(40),
    subcategory: z.string().min(1).max(40),
    placeId: z.string().max(40).optional(),
  })
  .catchall(z.string().max(80))
  .superRefine((v, ctx) => {
    if (!isSubcategoryOf(v.category, v.subcategory))
      ctx.addIssue({ code: 'custom', path: ['subcategory'], message: 'not in the category' });
    for (const key of Object.keys(v))
      if (
        !['country', 'category', 'subcategory', 'placeId'].includes(key) &&
        !ALL_ATTRIBUTES.has(key)
      )
        ctx.addIssue({ code: 'custom', path: [key], message: 'unknown parameter' });
  });

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

  @Get('autocomplete')
  async autocomplete(
    @Query(new ZodValidationPipe(autocompleteSchema))
    { q, country }: z.infer<typeof autocompleteSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Autocomplete> {
    void reply.header('cache-control', 'public, max-age=60');
    return this.search.autocomplete(q, country);
  }

  /** A listing's price against comparable listings (ADR-0043); `insight` is null without enough. */
  @Get('listings/:id/price-insight')
  async priceInsight(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ insight: PriceInsight | null }> {
    void reply.header('cache-control', 'public, max-age=300');
    return { insight: await this.search.priceInsight(id) };
  }

  /** What comparable listings cost, for a seller filling in the form (ADR-0043). */
  @Get('price-guide')
  async priceGuide(
    @Query(new ZodValidationPipe(guideSchema)) q: z.infer<typeof guideSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ guide: (PriceStats & { currency: string }) | null }> {
    void reply.header('cache-control', 'public, max-age=300');
    const { country, category, subcategory, placeId, ...rest } = q;
    const attributes = Object.fromEntries(
      Object.entries(rest).map(([k, v]) => [
        k,
        ALL_ATTRIBUTES.get(k)?.kind === 'number' && v !== '' ? Number(v) : v,
      ]),
    );
    const region = placeId ? findPlace(placeId)?.region : undefined;
    return {
      guide: await this.search.priceGuide({ country, category, subcategory, region, attributes }),
    };
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
