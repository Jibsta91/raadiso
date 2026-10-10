import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { bodyEtag, conditionalGets, ifNoneMatchHits, publicCache } from '../src/http-cache.js';

describe('conditional GETs', () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
    conditionalGets(app);
    app.get('/public', async (_req, reply) => {
      publicCache(reply, 30);
      return { items: [1, 2, 3] };
    });
    // Personalised for a signed-in caller, like a listing page for its owner.
    app.get('/listing', async (req, reply) => {
      if (req.headers['x-test-user']) void reply.header('cache-control', 'private, no-store');
      else publicCache(reply, 30, { vary: ['Authorization', 'Cookie'] });
      return { id: 'a', viewer: req.headers['x-test-user'] ?? null };
    });
    app.get('/unmarked', async (_req, reply) => {
      void reply.header('cache-control', 'public, max-age=30');
      return { ok: true };
    });
    app.get('/missing', async (_req, reply) => {
      publicCache(reply, 30);
      return reply.code(404).send({ status: 404 });
    });
    await app.ready();
  });
  after(() => app.close());

  it('adds stale-while-revalidate and a strong ETag over the body', async () => {
    const res = await app.inject({ method: 'GET', url: '/public' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'public, max-age=30, stale-while-revalidate=60');
    assert.equal(res.headers.etag, bodyEtag(res.body));
    assert.match(String(res.headers.etag), /^"[A-Za-z0-9_-]{22}"$/);
  });

  it('answers 304 without a body when If-None-Match matches', async () => {
    const first = await app.inject({ method: 'GET', url: '/public' });
    const etag = String(first.headers.etag);
    const res = await app.inject({
      method: 'GET',
      url: '/public',
      headers: { 'if-none-match': `"other", W/${etag}` },
    });
    assert.equal(res.statusCode, 304);
    assert.equal(res.body, '');
    assert.equal(res.headers.etag, etag);
    assert.equal(res.headers['cache-control'], 'public, max-age=30, stale-while-revalidate=60');
  });

  it('answers 200 with the body when the ETag differs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public',
      headers: { 'if-none-match': '"stale"' },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { items: [1, 2, 3] });
  });

  it('supports HEAD', async () => {
    const etag = String((await app.inject({ method: 'GET', url: '/public' })).headers.etag);
    const res = await app.inject({
      method: 'HEAD',
      url: '/public',
      headers: { 'if-none-match': etag },
    });
    assert.equal(res.statusCode, 304);
  });

  it('never tags or short-circuits personalised or credentialed answers', async () => {
    const anon = await app.inject({ method: 'GET', url: '/listing' });
    assert.equal(anon.headers.vary, 'Authorization, Cookie');
    const etag = String(anon.headers.etag);
    assert.ok(etag.startsWith('"'));

    const owner = await app.inject({
      method: 'GET',
      url: '/listing',
      headers: { 'x-test-user': 'u1', 'if-none-match': etag },
    });
    assert.equal(owner.statusCode, 200);
    assert.equal(owner.headers.etag, undefined);
    assert.equal(owner.headers['cache-control'], 'private, no-store');

    const bearer = await app.inject({
      method: 'GET',
      url: '/public',
      headers: { authorization: 'Bearer x', 'if-none-match': etag },
    });
    assert.equal(bearer.statusCode, 200);
    assert.equal(bearer.headers.etag, undefined);
  });

  it('leaves routes that did not opt in, and errors, alone', async () => {
    const unmarked = await app.inject({ method: 'GET', url: '/unmarked' });
    assert.equal(unmarked.headers.etag, undefined);
    assert.equal(unmarked.headers['cache-control'], 'public, max-age=30');
    const missing = await app.inject({
      method: 'GET',
      url: '/missing',
      headers: { 'if-none-match': '*' },
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers.etag, undefined);
  });
});

describe('ifNoneMatchHits', () => {
  it('uses the weak comparison and understands lists and *', () => {
    assert.equal(ifNoneMatchHits(undefined, '"a"'), false);
    assert.equal(ifNoneMatchHits('"a"', '"a"'), true);
    assert.equal(ifNoneMatchHits('W/"a"', '"a"'), true);
    assert.equal(ifNoneMatchHits('"b", "a"', '"a"'), true);
    assert.equal(ifNoneMatchHits('"b"', '"a"'), false);
    assert.equal(ifNoneMatchHits('*', '"a"'), true);
    assert.equal(ifNoneMatchHits(['"b"', '"a"'], '"a"'), true);
  });
});
