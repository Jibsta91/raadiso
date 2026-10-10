// Pages ship only the messages their client components use (lib/client-messages.ts). For every page,
// layout and error boundary, each key a client component it reaches asks for must be in what the page
// provides: the global set plus the <ClientMessages set="…"> sets of the page and its layouts.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { CLIENT_MESSAGES, GLOBAL, pickMessages } from '../src/lib/client-messages.ts';
import {
  ALL_USES,
  CLIENT_FILES,
  covered,
  FILES,
  loadMessages,
  reach,
  rel,
  SRC,
} from './i18n-usage.ts';

const APP = join(SRC, 'app');
const ENTRIES = [...FILES.keys()].filter((f) =>
  /\/(page|layout|error|not-found)\.tsx$/.test(f.slice(APP.length)),
);
const setsIn = (file: string) =>
  [...(FILES.get(file) ?? '').matchAll(/<ClientMessages\s+set="(\w+)"/g)].map(
    (m) => m[1] as keyof typeof CLIENT_MESSAGES,
  );

/** What a page's client components may read: the global set and its own and its layouts' sets. */
function provided(entry: string): string[] {
  const sets = setsIn(entry);
  for (let dir = dirname(entry); dir.startsWith(APP); dir = dirname(dir))
    sets.push(...setsIn(join(dir, 'layout.tsx')));
  return [...GLOBAL, ...sets.flatMap((set) => CLIENT_MESSAGES[set])];
}

describe('client messages', () => {
  it('finds pages and client components (sanity check of the scanner)', () => {
    assert.ok(ENTRIES.length > 30);
    assert.ok(CLIENT_FILES.size > 30);
  });

  for (const entry of ENTRIES) {
    it(`${rel(entry)} provides what its client components use`, () => {
      const files = reach(entry);
      const have = provided(entry);
      const missing = ALL_USES.filter(
        (u) => files.has(u.file) && CLIENT_FILES.has(u.file) && !covered(u.path, have),
      ).map((u) => `${rel(u.file)}:${u.line}: ${u.path}${u.exact ? '' : '.*'}`);
      assert.deepEqual([...new Set(missing)], []);
    });
  }

  it('names only paths that exist', () => {
    const en = loadMessages('en');
    for (const path of [...GLOBAL, ...Object.values(CLIENT_MESSAGES).flat()])
      assert.ok(JSON.stringify(pickMessages(en, [path])) !== '{}', path);
  });

  it('keeps the catalogue every page carries small', () => {
    const bytes = JSON.stringify(pickMessages(loadMessages('so'), GLOBAL)).length;
    assert.ok(bytes < 1024, `${bytes} bytes`);
  });
});
