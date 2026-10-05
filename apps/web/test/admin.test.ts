// Console helpers (ADR-0030): CSV export cells and human-readable durations.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvCell, targetHref } from '../src/lib/admin/audit.ts';
import { duration } from '../src/lib/admin/format.ts';
import { canOpen, SECTIONS } from '../src/lib/staff.ts';

describe('audit export', () => {
  it('quotes cells and defuses spreadsheet formulas', () => {
    assert.equal(csvCell('plain'), '"plain"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell('-1+2'), `"'-1+2"`);
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell({ added: ['support'] }), '"{""added"":[""support""]}"');
  });

  it('links targets the console has pages for', () => {
    assert.equal(targetHref('user', 'u1'), '/admin/users/u1');
    assert.equal(targetHref('review', 'r1'), null);
  });
});

describe('durations', () => {
  it('shows the two largest units', () => {
    assert.equal(duration(42, 'en'), '42s');
    assert.equal(duration(3 * 3600 + 5 * 60 + 9, 'en'), '3h 5m');
    assert.equal(duration(90_000, 'en'), '1d 1h');
  });
});

describe('sections by role', () => {
  it('keeps operators away from user data', () => {
    for (const section of ['users', 'listings', 'orders', 'reviews', 'audit'] as const)
      assert.equal(canOpen(section, ['operator']), false, section);
    assert.equal(canOpen('operations', ['operator']), true);
  });

  it('gives platform admins every section', () => {
    for (const section of Object.keys(SECTIONS) as Array<keyof typeof SECTIONS>)
      assert.equal(canOpen(section, ['platform-admin']), true, section);
  });
});
