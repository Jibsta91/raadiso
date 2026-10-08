import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const src = new URL('../../src/', import.meta.url);

/** The names a module exports, following `export *` (value and type names alike). */
function exported(file: string): string[] {
  const code = readFileSync(new URL(file, src), 'utf8');
  const names: string[] = [];
  for (const m of code.matchAll(/^export \* from '\.\/([\w-]+)\.js';$/gm))
    names.push(...exported(`${m[1]}.ts`));
  for (const m of code.matchAll(
    /^export (?:declare )?(?:const|function|class|let|type|interface) (\w+)/gm,
  ))
    names.push(m[1]!);
  for (const m of code.matchAll(/^export (?:type )?\{([^}]*)\}/gm))
    for (const part of m[1]!.split(','))
      if (part.trim())
        names.push(
          part
            .trim()
            .replace(/^type /, '')
            .split(/\s+as\s+/)
            .pop()!,
        );
  return names;
}

describe('package entry points', () => {
  it('provide every name by one path only (import-in-the-middle drops duplicates)', () => {
    for (const entry of ['index.ts', 'taxonomy.ts', 'attributes.ts']) {
      const names = exported(entry);
      const twice = names.filter((n, i) => names.indexOf(n) !== i);
      assert.deepEqual([...new Set(twice)], [], `${entry} exports these twice`);
    }
  });
});
