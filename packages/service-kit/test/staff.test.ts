import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtVerifier, Principal } from '../src/jwt.js';
import { JwtAuthGuard, Roles, Staff, StepUpRequiredException } from '../src/nest.js';

class Endpoints {
  @Staff(['support', 'platform-admin'])
  read() {}

  @Staff(['platform-admin'], { stepUp: true })
  refund() {}

  @Roles('user')
  website() {}
}

const now = () => Math.floor(Date.now() / 1000);

function guardFor(claims: Record<string, unknown>, roles: string[]) {
  const verifier = {
    verify: async (): Promise<Principal> => ({
      sub: '11111111-2222-3333-4444-555555555555',
      roles,
      scopes: [],
      claims,
    }),
  } as unknown as JwtVerifier;
  const guard = new JwtAuthGuard(new Reflector(), verifier);
  return (handler: keyof Endpoints) =>
    guard.canActivate({
      getHandler: () => Endpoints.prototype[handler],
      getClass: () => Endpoints,
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer t' } }),
      }),
    } as unknown as ExecutionContext);
}

describe('staff endpoints (ADR-0030)', () => {
  it('accept console tokens with the role', async () => {
    const call = guardFor({ azp: 'raadi-admin', auth_time: now() }, ['support']);
    assert.equal(await call('read'), true);
  });

  it('refuse website tokens, even for staff', async () => {
    const call = guardFor({ azp: 'raadi-bff', auth_time: now() }, ['platform-admin']);
    await assert.rejects(call('read'), /admin console tokens only/);
    // Ordinary endpoints are unaffected.
    assert.equal(await guardFor({ azp: 'raadi-bff' }, ['user'])('website'), true);
  });

  it('refuse console tokens without the role', async () => {
    const call = guardFor({ azp: 'raadi-admin', auth_time: now() }, ['operator']);
    await assert.rejects(call('read'), /Insufficient role/);
  });

  it('ask for a recent sign-in on step-up endpoints (RFC 9470)', async () => {
    const fresh = guardFor({ azp: 'raadi-admin', auth_time: now() - 60 }, ['platform-admin']);
    assert.equal(await fresh('refund'), true);
    const stale = guardFor({ azp: 'raadi-admin', auth_time: now() - 3600 }, ['platform-admin']);
    await assert.rejects(stale('refund'), (e: unknown) => e instanceof StepUpRequiredException);
    const missing = guardFor({ azp: 'raadi-admin' }, ['platform-admin']);
    await assert.rejects(missing('refund'), (e: unknown) => e instanceof StepUpRequiredException);
  });

  it('cannot be declared with @Roles, which a website token would pass', () => {
    for (const role of ['moderator', 'support', 'operator', 'platform-admin']) {
      assert.throws(() => Roles('user', role), /staff roles belong in @Staff/);
    }
    assert.doesNotThrow(() => Roles('user'));
  });
});
