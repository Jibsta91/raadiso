import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** How long a cache may keep serving a public answer while it fetches a fresh one, in seconds. */
export const STALE_WHILE_REVALIDATE_SECONDS = 60;

const PUBLIC_CACHE = Symbol.for('raadi.publicCache');
type Marked = FastifyReply & { [PUBLIC_CACHE]?: true };

export interface PublicCacheOptions {
  /** Seconds a cache may serve it stale while revalidating (default 60). */
  staleWhileRevalidate?: number;
  /**
   * Request headers the answer depends on. A route that answers signed-in visitors differently
   * (privately) names `Authorization` and `Cookie` here, so no cache serves one to the other.
   */
  vary?: readonly string[];
}

/**
 * Marks a GET answer as the same for everyone: `Cache-Control: public, max-age=<n>,
 * stale-while-revalidate=<s>`, and (through {@link conditionalGets}) a strong ETag over the body with
 * `304 Not Modified` for a matching `If-None-Match`. Only for answers that carry nothing personal:
 * a route that personalises for a signed-in caller must not call it for that caller.
 */
export function publicCache(
  reply: FastifyReply,
  maxAgeSeconds: number,
  opts: PublicCacheOptions = {},
): void {
  const swr = opts.staleWhileRevalidate ?? STALE_WHILE_REVALIDATE_SECONDS;
  void reply.header(
    'cache-control',
    `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${swr}`,
  );
  if (opts.vary?.length) void reply.header('vary', opts.vary.join(', '));
  (reply as Marked)[PUBLIC_CACHE] = true;
}

/** A strong validator for a body: the first 128 bits of its SHA-256, base64url. */
export function bodyEtag(body: string | Buffer): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
}

/** RFC 9110 §13.1.2: If-None-Match uses the weak comparison, and `*` matches any current answer. */
export function ifNoneMatchHits(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const value = Array.isArray(header) ? header.join(',') : header;
  if (value.trim() === '*') return true;
  const opaque = etag.replace(/^W\//, '');
  return value.split(',').some((t) => t.trim().replace(/^W\//, '') === opaque);
}

/**
 * Conditional GETs for answers marked with {@link publicCache}: a strong ETag over the body and a
 * `304` without the body when the client already has it. Nothing else changes: answers that are not
 * marked, are not a 200, came from a request with credentials, or ended up private keep no ETag
 * from here.
 */
export function conditionalGets(fastify: FastifyInstance): void {
  fastify.addHook(
    'onSend',
    async (req: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> => {
      if (!(reply as Marked)[PUBLIC_CACHE]) return payload;
      if (req.method !== 'GET' && req.method !== 'HEAD') return payload;
      if (reply.statusCode !== 200) return payload;
      // A caller with credentials may be shown more (an owner's view): leave it alone.
      if (req.headers.authorization) return payload;
      const cacheControl = String(reply.getHeader('cache-control') ?? '');
      if (!/\bpublic\b/.test(cacheControl) || /\b(private|no-store)\b/.test(cacheControl)) {
        return payload;
      }
      if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
      const etag = bodyEtag(payload);
      void reply.header('etag', etag);
      if (!ifNoneMatchHits(req.headers['if-none-match'], etag)) return payload;
      void reply.code(304);
      reply.removeHeader('content-type');
      reply.removeHeader('content-length');
      return '';
    },
  );
}
