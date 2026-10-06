// Right-to-left readiness (ADR-0032): layout uses logical Tailwind classes (ms-, pe-, start-, text-end …),
// which mirror on their own when a language reads right to left. Physical ones (ml-, left-, text-left …)
// would not, so none may come back.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

const ROOTS = ['src', '../../packages/ui/src'];
const PHYSICAL =
  /(?<=[\s"'`:])-?(?:[mp][lr]-|left-(?!1\/2)|right-(?!1\/2)|text-(?:left|right)(?=[\s"'`])|border-[lr](?=[-\s"'`])|rounded-(?:[lr]|[tb][lr])(?=[-\s"'`]))/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

it('uses logical (start/end) classes, never left/right ones', () => {
  const found = ROOTS.flatMap(files).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => {
        const m = PHYSICAL.exec(line);
        return m ? [`${file}:${i + 1}: ${m[0]}`] : [];
      }),
  );
  assert.deepEqual(found, []);
});
