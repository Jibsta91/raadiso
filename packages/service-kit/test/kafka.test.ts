import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { isBug } from '../src/kafka.js';

const sqlError = (code: string) => Object.assign(new Error('pg'), { code });

describe('isBug: which failed events may leave the partition (dead-letter topic)', () => {
  it('code and data errors are bugs: retrying fails the same way', () => {
    assert.ok(isBug(new TypeError("Cannot read properties of undefined (reading 'id')")));
    assert.ok(isBug(new ReferenceError('x is not defined')));
    assert.ok(isBug(new RangeError('Invalid time value')));
    assert.ok(isBug(z.object({ id: z.uuid() }).safeParse({ id: 1 }).error));
    assert.ok(isBug(sqlError('23505'))); // unique violation
    assert.ok(isBug(sqlError('22P02'))); // invalid text representation
    assert.ok(isBug(sqlError('42703'))); // undefined column
  });

  it('a dependency being down is never a bug: those events wait', () => {
    assert.ok(!isBug(new TypeError('fetch failed')));
    assert.ok(!isBug(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
    assert.ok(!isBug(sqlError('57P01'))); // admin shutdown
    assert.ok(!isBug(sqlError('08006'))); // connection failure
    assert.ok(!isBug(sqlError('40001'))); // serialization failure: retry
    assert.ok(!isBug(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' })));
    assert.ok(!isBug(new Error('listings returned 503')));
    assert.ok(!isBug('not an error'));
  });
});
