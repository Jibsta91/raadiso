import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type AuthenticatedRequest, Public, Roles, ZodValidationPipe } from '@raadi/service-kit';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import {
  eligibilityQuerySchema,
  myReviewsQuerySchema,
  pageQuerySchema,
  reviewBodySchema,
} from './model.js';
import { TrustService } from './trust.service.js';

const uuidPipe = new ParseUUIDPipe({ version: undefined });

@Controller('api/v1/trust')
@Roles('user')
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  // ---------------------------------------------------------------- public

  @Public()
  @Get('users/:id')
  profile(
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) q: z.infer<typeof pageQuerySchema>,
  ) {
    return this.trust.profile(id, q.limit, q.offset);
  }

  @Public()
  @Get('listings/:id/seller')
  seller(@Param('id', uuidPipe) id: string) {
    return this.trust.sellerOf(id);
  }

  // ---------------------------------------------------------------- signed in

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.trust.me(req.principal!);
  }

  /** The caller's reviews, received or given (ADR-0055). */
  @Get('me/reviews')
  myReviews(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(myReviewsQuerySchema)) q: z.infer<typeof myReviewsQuerySchema>,
  ) {
    return this.trust.myReviews(req.principal!, q.direction, q.limit, q.offset);
  }

  /** Finished deals the caller may still review, closest deadline first (ADR-0055). */
  @Get('me/pending-reviews')
  pendingReviews(@Req() req: AuthenticatedRequest) {
    return this.trust.pendingReviews(req.principal!);
  }

  @Get('eligibility')
  eligibility(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(eligibilityQuerySchema)) q: z.infer<typeof eligibilityQuerySchema>,
  ) {
    return this.trust.eligibility(req.principal!, q.listingId, q.subjectId);
  }

  @Post('reviews')
  @HttpCode(201)
  // Real users write a handful of reviews; this caps scripted abuse per client.
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  createReview(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(reviewBodySchema)) body: z.infer<typeof reviewBodySchema>,
  ) {
    const token = req.headers.authorization!.slice('Bearer '.length);
    return this.trust.createReview(req.principal!, token, body);
  }

  @Delete('reviews/:id')
  @HttpCode(204)
  async removeReview(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.trust.removeReview(req.principal!, id);
  }

  // ---------------------------------------------------------------- verification

  /** Browser navigation: redirects to BankID (or to login first). */
  @Public()
  @Get('verification/start')
  async startVerification(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    redirect(reply, await this.trust.startVerification(req.principal, query));
  }

  /** BankID redirects back here; the outcome is appended to the return path. */
  @Public()
  @Get('verification/callback')
  async verificationCallback(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const raw = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    redirect(reply, await this.trust.completeVerification(req.principal, raw));
  }

  @Delete('verification')
  @HttpCode(204)
  async removeVerification(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.trust.removeVerification(req.principal!);
  }
}

function redirect(reply: FastifyReply, location: string): void {
  void reply.status(302).header('location', location).header('cache-control', 'no-store').send();
}
