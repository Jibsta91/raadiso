// Money leaving the platform needs a recent sign-in (step-up, ADR-0030); every console action that
// changes something is classified here.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { staffRoutes } from '@raadi/service-kit';
import { PaymentsAdminController } from '../../src/payments/admin.js';

const STEP_UP = ['refund'];
const NO_STEP_UP: string[] = [];

it('refunds need a recent sign-in, and every change is classified', () => {
  const routes = staffRoutes(PaymentsAdminController);
  for (const r of routes) {
    if (STEP_UP.includes(r.handler)) assert.equal(r.stepUp, true, `${r.handler} needs step-up`);
    else if (r.method !== 'GET') {
      assert.ok(
        NO_STEP_UP.includes(r.handler),
        `${r.method} ${r.handler}: step-up or not? Add it to a list`,
      );
    }
  }
  assert.ok(routes.some((r) => r.handler === 'refund'));
});
