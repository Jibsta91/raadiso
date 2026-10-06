// Which console actions need a recent sign-in (step-up, ADR-0030). A new action that changes something
// must be added to one of the two lists below, so nobody adds a dangerous one without deciding.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { staffRoutes } from '@raadi/service-kit';
import { UserAdminController } from '../../src/staff/users.admin.js';

/** Take over or lock out an account, or change who is staff. */
const STEP_UP = ['suspend', 'unsuspend', 'roles', 'resetOtp'];
/** Change something, but nothing that needs a fresh sign-in (recorded in the audit log). */
const NO_STEP_UP = ['addNote', 'signOut', 'email', 'unlock'];

it('dangerous account actions need a recent sign-in, and every change is classified', () => {
  const routes = staffRoutes(UserAdminController);
  for (const r of routes) {
    if (STEP_UP.includes(r.handler)) assert.equal(r.stepUp, true, `${r.handler} needs step-up`);
    else if (r.method !== 'GET') {
      assert.ok(
        NO_STEP_UP.includes(r.handler),
        `${r.method} ${r.handler}: step-up or not? Add it to a list`,
      );
    }
  }
  for (const name of STEP_UP)
    assert.ok(
      routes.some((r) => r.handler === name),
      `${name} exists`,
    );
});
