// The page Content-Security-Policy (review A5): scripts need this request's nonce; nothing inline.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentSecurityPolicy, newNonce, nonceFrom } from '../src/lib/csp.ts';

describe('content security policy', () => {
  const opts = { authBaseUrl: 'https://auth.example.test', dev: false };

  it('allows scripts only with the nonce, and never inline', () => {
    const csp = contentSecurityPolicy('abc123', opts);
    const scripts = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    assert.equal(scripts, "script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self' https:\/\/auth\.example\.test/);
  });

  it("adds 'unsafe-eval' only for the development server", () => {
    assert.match(contentSecurityPolicy('n', { ...opts, dev: true }), /'unsafe-eval'/);
  });

  it('makes a new random nonce each time, and reads it back from the policy', () => {
    const a = newNonce();
    assert.notEqual(a, newNonce());
    assert.ok(a.length >= 22);
    assert.equal(nonceFrom(contentSecurityPolicy(a, opts)), a);
    assert.equal(nonceFrom(null), undefined);
  });
});
