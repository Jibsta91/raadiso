# 0059 — Speed on the server: an image cache, conditional GETs, a short search cache

- Status: Accepted
- Date: 2026-10-11
- Amends [ADR-0014](0014-media-pipeline.md) (how images are served) and
  [ADR-0015](0015-search.md). Budget: [ADR-0011](0011-resource-budget.md).

## Context

Measured on raadiso.com:

- **Images.** imgproxy rendered every image on every request: the same card URL took 197–208 ms to
  the first byte each time (about 90 ms of it processing), and six parallel requests queued for
  227–536 ms on `IMGPROXY_WORKERS=2`. Signed URLs never change what they show (ADR-0014), yet nothing
  cached them and browsers were not told they are immutable.
- **APIs.** Search answered `public, max-age=15` and listings `public, max-age=30`, without
  `stale-while-revalidate`. A listing's ETag was its version (`"1"`), and `If-None-Match` never gave a
  `304`. The website renders on the server with `cache: 'no-store'` over internal URLs, so caching
  inside the services matters more than headers. The front page and the category pages ask search the
  same anonymous questions for every visitor.

## Decision

1. **An image cache in front of imgproxy: `img-cache`** (nginx 1.30, stable branch, BSD-2-Clause;
   the `nginxinc/nginx-unprivileged` alpine-slim image pinned by version and digest, user 101,
   read-only root, `/tmp` on tmpfs). Traefik's `images` and `admin-images` routes go to it; the media
   service still calls imgproxy directly to re-encode uploads.
   - Only paths shaped like signed URLs are proxied (anything else is a 404 from nginx). The cache key
     is the path; the query string is dropped, so it can't split or poison the cache.
   - On disk in the `img-cache` volume: at most 2 GB (and never below 1 GB free), entries unused for
     30 days are dropped. A `200` is fresh for an hour, then revalidated in the background with
     imgproxy's ETag: a `304` that renders nothing (about 9 ms instead of a render) but notices a
     deleted source. A removed listing's photos (deleted by the orphan GC, ADR-0014) leave the cache
     within the hour of their next request. A `404` is kept for a minute; other errors never.
   - One render per variant however many ask at once (`proxy_cache_lock`); stale copies are served
     while refreshing and when imgproxy fails.
   - Browsers get `Cache-Control: public, max-age=31536000, immutable` on `200`/`304`, and `no-store`
     on errors (a refused signature, a missing image). `X-Cache-Status` says HIT, MISS, STALE, …
   - Access logs are JSON without client addresses.
2. **Conditional GETs and stale-while-revalidate on public answers**, once, in service-kit:
   `publicCache(reply, maxAge)` sets `public, max-age=<n>, stale-while-revalidate=60` and opts the
   route in to a strong ETag (SHA-256 over the body, 128 bits) with `304 Not Modified` on a matching
   `If-None-Match` (RFC 9110 weak comparison, lists and `*`). It is a Fastify `onSend` hook installed
   by `noStoreByDefault()`, about 30 lines and no new dependency. It never applies to a request with credentials (`Authorization`), to an
   answer that isn't a `200`, or to one that ended up `private`/`no-store`.
   - Routes: search (listings, autocomplete, suggest, similar, price insight, price guide), a listing
     for visitors, a listing's price history, and trust's public profile and a listing's seller (now
     `max-age=60`; they were `no-store`, but carry only what every listing page shows). A listing
     answers its owner `private, no-store` with the version ETag (for `If-Match`), and both answers
     carry `Vary: Authorization, Cookie`.
3. **A short in-process cache in search** (`services/search/src/search/search.cache.ts`): anonymous
   listing searches are answered from a bounded LRU (256 answers of about 20–40 KB of JSON each),
   fresh for 15 s, then served stale for up to 30 s more while one background search refreshes them.
   Concurrent misses share one search. The key is every validated parameter with its defaults, keys
   sorted, plus the country searched (the API has no locale: answers don't depend on the language).
   A request with a token, the visitor's own position (`lat`/`lon`) and the saved-search time windows
   bypass it. Each listing event the indexer applies caps every answer's freshness at the moment the
   change is searchable (OpenSearch refreshes every second; 1.5 s), so new and removed listings show
   up as fast as before, without emptying the cache. Metrics: `raadi.search.cache.requests` by
   outcome (hit, stale, miss, bypass) and `raadi.search.cache.entries`. Settings:
   `SEARCH_CACHE_TTL_MS` (0 turns it off), `SEARCH_CACHE_STALE_MS`, `SEARCH_CACHE_MAX_ENTRIES`.
4. **imgproxy in production: four workers on two cores, 512 MB** (was two workers, one core, 320 MB).
   With the cache, imgproxy renders only new variants and re-encodes uploads, but those come in
   bursts (a new listing's photos in three presets, a 2560 px upload holding a worker), which is when
   requests queued. The server has eight cores (ADR-0051); libvips needs about 100 MB per busy worker
   at most. Development keeps two workers.

## Alternatives considered

- **Varnish** (BSD-2-Clause too): more than we need for one route, and its file storage is less
  simple than nginx's bounded `proxy_cache_path`.
- **Caching in Traefik:** Traefik Proxy has no cache middleware of its own, only third-party plugins.
- **A CDN:** a cloud service that doesn't run offline (ADR-0009). The immutable header lets one be
  added later.
- **Thumbnails stored at upload time:** ADR-0014 rejected it (backfills for every new size).
- **`@fastify/etag`** (MIT): it tags every route, the private ones included, where we want an opt-in
  per route that also sets the cache headers.
- **Valkey for search answers:** shared across replicas, but search runs as one replica and a network
  hop would eat most of the gain; the in-process cache needs nothing new.

## Consequences

- `img-cache` uses about 6 MB of its 64 MB limit at rest (the key zone is 16 MB of shared memory,
  touched as it fills; the kernel's file cache for hot images counts towards the limit but is
  reclaimed first). The default profile grows by one container and about 10 MB (ADR-0011). The
  `img-cache` volume grows to at most 2 GB.
- An image changed in place would keep its old cached copy: never done, because a new upload gets a
  new id and so a new signed URL. Cached images outlive a source deletion by at most an hour (from
  the next request) in the cache, and for the browsers that already have them, a year.
- Search answers can be up to 15 s (or one stale answer) behind the index between listing events.
  Search's memory grows by up to about 25 MB at 256 answers (its limit stays 256 MB).
- nginx has no Prometheus metrics of its own here; the cache's hit rate is in its JSON access log
  (`cache` field, Loki).
