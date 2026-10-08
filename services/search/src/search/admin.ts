import { Controller, Get, Query } from '@nestjs/common';
import { COUNTRY_CODES } from '@raadi/catalog';
import { Staff, ZodValidationPipe } from '@raadi/service-kit';
import { z } from 'zod';
import { INDEX_VERSION } from './index-definition.js';
import { DEFAULT_WEIGHTS, searchParamsSchema } from './query.js';
import { SearchIndex } from './search.index.js';
import { type RankingLab, SearchService } from './search.service.js';

const weight = z.coerce.number().min(0).max(3);
const labSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    country: z.enum(COUNTRY_CODES).optional(),
    category: z.string().max(40).optional(),
    quality: weight.optional(),
    freshness: weight.optional(),
  })
  .strict();

export interface IndexStatus {
  alias: string;
  version: number;
  documents: number;
  byStatus: Array<{ status: string; count: number }>;
  /** Size on disk, when the search user may read index statistics. */
  sizeBytes: number | null;
  /** Newest `updatedAt` in the index: how fresh the index is. */
  newestUpdateAt: string | null;
}

/** The search index for operators (ADR-0030): size and freshness, to compare with listings. */
@Controller('admin/v1/search')
export class SearchAdminController {
  constructor(
    private readonly index: SearchIndex,
    private readonly search: SearchService,
  ) {}

  /** The ranking lab (ADR-0042): best match with previewed weights, each score taken apart. */
  @Get('ranking')
  @Staff(['operator', 'platform-admin'])
  async ranking(
    @Query(new ZodValidationPipe(labSchema)) query: z.infer<typeof labSchema>,
  ): Promise<RankingLab> {
    const { quality, freshness, ...search } = query;
    const params = searchParamsSchema.parse({ ...search, pageSize: '24' });
    const weights = {
      quality: quality ?? DEFAULT_WEIGHTS.quality,
      freshness: freshness ?? DEFAULT_WEIGHTS.freshness,
    };
    return this.search.rankingLab(params, weights);
  }

  @Get('index')
  @Staff(['operator', 'platform-admin'])
  async status(): Promise<IndexStatus> {
    const [agg, stats] = await Promise.all([
      this.index.client.search({
        index: this.index.alias,
        body: {
          size: 0,
          track_total_hits: true,
          aggs: {
            status: { terms: { field: 'status', size: 10 } },
            newest: { max: { field: 'updatedAt' } },
          },
        } as Record<string, unknown>,
      }),
      this.index.client.indices
        .stats({ index: this.index.alias, metric: 'store' })
        .catch(() => null),
    ]);
    const body = agg.body as unknown as {
      hits: { total: { value: number } };
      aggregations: {
        status: { buckets: Array<{ key: string; doc_count: number }> };
        newest: { value: number | null };
      };
    };
    const size = (stats?.body as { _all?: { total?: { store?: { size_in_bytes?: number } } } })
      ?._all?.total?.store?.size_in_bytes;
    return {
      alias: this.index.alias,
      version: INDEX_VERSION,
      documents: body.hits.total.value,
      byStatus: body.aggregations.status.buckets.map((b) => ({
        status: b.key,
        count: b.doc_count,
      })),
      sizeBytes: size ?? null,
      newestUpdateAt: body.aggregations.newest.value
        ? new Date(body.aggregations.newest.value).toISOString()
        : null,
    };
  }
}
