// Post-login redirects stay on this site (the welcome page's ?next=).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safePath } from '../src/lib/safe-path.ts';

describe('safePath', () => {
  it('keeps same-site paths with their query and hash', () => {
    assert.equal(safePath('/nb/account?tab=1#x', '/nb'), '/nb/account?tab=1#x');
  });
  for (const evil of [
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '',
    undefined,
    42,
  ]) {
    it(`refuses ${JSON.stringify(evil)}`, () => assert.equal(safePath(evil, '/nb'), '/nb'));
  }
});
