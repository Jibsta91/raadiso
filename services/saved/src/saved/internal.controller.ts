import { Controller, Get, Query } from '@nestjs/common';
import { Roles, ZodValidationPipe } from '@raadi/service-kit';
import { z } from 'zod';
import { SavedRepository } from './saved.repository.js';

/** At most one page of the owner's listings (listings' /mine pages hold up to 100). */
const countsQuerySchema = z.object({
  ids: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(100)),
});

/**
 * Service-to-service API. The gateway only routes /api/v1/saved, so this path is reachable on the
 * internal network only, and callers still need a valid user token (zero trust between services).
 */
@Controller('internal/v1/saved')
export class InternalSavedController {
  constructor(private readonly repo: SavedRepository) {}

  /**
   * How many people saved each listing (listings' My listings, for the owner). Counts only: never
   * who. Listings asks only about the caller's own listings.
   */
  @Get('favourites/counts')
  @Roles('user')
  async favouriteCounts(
    @Query(new ZodValidationPipe(countsQuerySchema)) q: z.infer<typeof countsQuerySchema>,
  ): Promise<{ counts: Record<string, number> }> {
    return { counts: await this.repo.favouriteCounts(q.ids) };
  }
}
