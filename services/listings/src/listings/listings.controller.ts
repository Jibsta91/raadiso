import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthenticatedRequest,
  Public,
  publicCache,
  Roles,
  ZodValidationPipe,
} from '@raadi/service-kit';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type CreateListing,
  createListingSchema,
  type Listing,
  type UpdateListing,
  updateListingSchema,
} from './listing.model.js';
import type { PriceChange } from './listings.repository.js';
import { ListingsService } from './listings.service.js';

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const mineSchema = pageSchema.extend({
  /** Also listings a moderator removed in the last 90 days, with the reason (the owner's view). */
  removed: z.enum(['true', 'false']).default('false'),
});

const WRITE_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
/** Views: one per listing page in a browser session, so a generous limit per client. */
const VIEW_THROTTLE = { default: { limit: 120, ttl: 60_000 } };

/** ETag carries the version so clients can send If-Match (optimistic concurrency). */
const etag = (l: Listing) => `"${l.version}"`;
function parseIfMatch(header: string | undefined): number | undefined {
  const m = header?.match(/^(?:W\/)?"(\d+)"$/);
  return m ? Number(m[1]) : undefined;
}

@Controller('api/v1/listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get('mine')
  @Roles('user')
  mine(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(mineSchema)) page: z.infer<typeof mineSchema>,
  ) {
    const token = req.headers.authorization?.slice('Bearer '.length);
    return this.listings.mine(
      req.principal!,
      page.limit,
      page.offset,
      page.removed === 'true',
      token,
    );
  }

  /** One view of the listing page, anonymous (ADR-0045): a counter only. */
  @Public()
  @Post(':id/views')
  @HttpCode(204)
  @Throttle(VIEW_THROTTLE)
  async view(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.listings.view(id, req.principal);
  }

  /** The owner moves an active listing back to the top, at most once a week (ADR-0045). */
  @Post(':id/renew')
  @Roles('user')
  @Throttle(WRITE_THROTTLE)
  async renew(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Listing> {
    return this.listings.renew(req.principal!, id);
  }

  /** A listing's prices over time, newest first (ADR-0044). Public, like the listing. */
  @Public()
  @Get(':id/price-history')
  async priceHistory(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ items: PriceChange[] }> {
    publicCache(reply, 60);
    return { items: await this.listings.priceHistory(id) };
  }

  @Public()
  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Listing> {
    const listing = await this.listings.get(id, req.principal);
    // Personalised responses (viewer permissions) must not be shared by caches. A visitor's answer is
    // public, with an ETag over the body and 304s (ADR-0059); the owner's carries the version for If-Match.
    if (req.principal) {
      void reply
        .header('etag', etag(listing))
        .header('cache-control', 'private, no-store')
        .header('vary', 'Authorization, Cookie');
    } else {
      void reply.header('etag', etag(listing));
      publicCache(reply, 30, { vary: ['Authorization', 'Cookie'] });
    }
    return listing;
  }

  @Post()
  @Roles('user')
  @Throttle(WRITE_THROTTLE)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createListingSchema)) body: CreateListing,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Listing> {
    const listing = await this.listings.create(req.principal!, body);
    void reply
      .status(201)
      .header('location', `/api/v1/listings/${listing.id}`)
      .header('etag', etag(listing));
    return listing;
  }

  @Patch(':id')
  @Roles('user')
  @Throttle(WRITE_THROTTLE)
  async update(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateListingSchema)) body: UpdateListing,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Listing> {
    const listing = await this.listings.update(req.principal!, id, body, parseIfMatch(ifMatch));
    void reply.header('etag', etag(listing));
    return listing;
  }

  @Delete(':id')
  @Roles('user')
  @Throttle(WRITE_THROTTLE)
  @HttpCode(204)
  async remove(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.listings.remove(req.principal!, id);
  }
}
