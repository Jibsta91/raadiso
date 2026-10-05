import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type AuthenticatedRequest,
  type Principal,
  Staff,
  ZodValidationPipe,
} from '@raadi/service-kit';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../tokens.js';
import { TrustRepository } from './trust.repository.js';

export const REVIEW_REMOVAL_REASONS = [
  'abusive',
  'personal_data',
  'not_genuine',
  'off_topic',
  'other',
] as const;

export const reviewsQuerySchema = z
  .object({
    user: z.uuid().optional(),
    /** about: reviews of the user; by: reviews the user wrote. Default both. */
    as: z.enum(['about', 'by']).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    removed: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const removeReviewSchema = z
  .object({
    reasonCode: z.enum(REVIEW_REMOVAL_REASONS),
    note: z.string().trim().max(500).default(''),
  })
  .strict();

export interface AdminReview {
  id: string;
  listingId: string;
  listingTitle: string;
  reviewerId: string;
  reviewerName: string;
  subjectId: string;
  subjectRole: 'buyer' | 'seller';
  rating: number;
  comment: string;
  createdAt: string;
  removedAt: string | null;
  removedBy: 'author' | 'moderator' | null;
}

export interface UserTrust {
  userId: string;
  name: string | null;
  verifiedAt: string | null;
  rating: { average: number | null; count: number };
  given: number;
  removed: number;
}

interface ReviewRow {
  id: string;
  listing_id: string;
  listing_title: string;
  reviewer_id: string;
  reviewer_name: string;
  subject_id: string;
  subject_role: 'buyer' | 'seller';
  rating: number;
  comment: string;
  created_at: Date;
  removed_at: Date | null;
  removed_by: 'author' | 'moderator' | null;
}

const toAdmin = (r: ReviewRow): AdminReview => ({
  id: r.id,
  listingId: r.listing_id,
  listingTitle: r.listing_title,
  reviewerId: r.reviewer_id,
  reviewerName: r.reviewer_name,
  subjectId: r.subject_id,
  subjectRole: r.subject_role,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.created_at.toISOString(),
  removedAt: r.removed_at?.toISOString() ?? null,
  removedBy: r.removed_by,
});

/** Reviews and verification for the admin console (ADR-0030). Console tokens only. */
@Injectable()
export class TrustAdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly repo: TrustRepository,
  ) {}

  async reviews(q: z.infer<typeof reviewsQuerySchema>) {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      args.push(value);
      where.push(sql.replaceAll('?', `$${args.length}`));
    };
    if (q.user) {
      if (q.as === 'about') add('subject_id = ?', q.user);
      else if (q.as === 'by') add('reviewer_id = ?', q.user);
      else add('(subject_id = ? OR reviewer_id = ?)', q.user);
    }
    if (q.rating) add('rating = ?', q.rating);
    if (q.removed === 'true') where.push('removed_at IS NOT NULL');
    if (q.removed === 'false') where.push('removed_at IS NULL');
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [page, count] = await Promise.all([
      this.pool.query<ReviewRow>(
        `SELECT * FROM reviews ${filter} ORDER BY created_at DESC, id DESC
          LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, q.limit, q.offset],
      ),
      this.pool.query<{ n: string }>(`SELECT count(*) AS n FROM reviews ${filter}`, args),
    ]);
    return {
      items: page.rows.map(toAdmin),
      total: Number(count.rows[0]!.n),
      limit: q.limit,
      offset: q.offset,
    };
  }

  async user(userId: string): Promise<UserTrust> {
    const { rows } = await this.pool.query<{
      name: string | null;
      verified_at: Date | null;
      average: string | null;
      count: string;
      given: string;
      removed: string;
    }>(
      `SELECT (SELECT display_name FROM people WHERE user_id = $1) AS name,
              (SELECT verified_at FROM verifications WHERE user_id = $1) AS verified_at,
              (SELECT avg(rating) FROM reviews WHERE subject_id = $1 AND removed_at IS NULL) AS average,
              (SELECT count(*) FROM reviews WHERE subject_id = $1 AND removed_at IS NULL) AS count,
              (SELECT count(*) FROM reviews WHERE reviewer_id = $1) AS given,
              (SELECT count(*) FROM reviews WHERE (subject_id = $1 OR reviewer_id = $1)
                  AND removed_by = 'moderator') AS removed`,
      [userId],
    );
    const r = rows[0]!;
    return {
      userId,
      name: r.name,
      verifiedAt: r.verified_at?.toISOString() ?? null,
      rating: {
        average: r.average === null ? null : Math.round(Number(r.average) * 10) / 10,
        count: Number(r.count),
      },
      given: Number(r.given),
      removed: Number(r.removed),
    };
  }

  async remove(actor: Principal, id: string, input: z.infer<typeof removeReviewSchema>) {
    const removed = await this.repo.removeReview(id, 'moderator', actor, input);
    if (!removed) throw new NotFoundException('Review not found or already removed');
  }
}

const uuid = new ParseUUIDPipe({ version: undefined });

/** /admin/v1/trust: reviews and verification for the console (not routed by the gateway). */
@Controller('admin/v1/trust')
export class TrustAdminController {
  constructor(private readonly admin: TrustAdminService) {}

  @Get('reviews')
  @Staff(['moderator', 'support', 'platform-admin'])
  reviews(@Query(new ZodValidationPipe(reviewsQuerySchema)) q: z.infer<typeof reviewsQuerySchema>) {
    return this.admin.reviews(q);
  }

  @Get('users/:id')
  @Staff(['moderator', 'support', 'platform-admin'])
  user(@Param('id', uuid) id: string) {
    return this.admin.user(id);
  }

  @Post('reviews/:id/remove')
  @Staff(['moderator', 'platform-admin'])
  @HttpCode(204)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(removeReviewSchema)) body: z.infer<typeof removeReviewSchema>,
  ) {
    await this.admin.remove(req.principal!, id, body);
  }
}
