// Colours come from the design tokens in globals.css (ADR-0021): semantic names such as text-rating,
// fill-favourite, bg-verified-soft or bg-scrim follow the light and dark themes and keep contrast in
// check. Tailwind's raw palette (amber-400, rose-500, bg-black/80, text-white …) does neither, so none
// may come back.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

const ROOTS = ['src', '../../packages/ui/src'];
const HUES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITIES =
  'bg|text|border(?:-[xyseblrt])?|fill|stroke|ring|ring-offset|outline|from|via|to|decoration|shadow|accent|caret|divide|placeholder';
const RAW = new RegExp(
  `(?<=[\\s"'\`:])(?:${UTILITIES})-(?:(?:${HUES})-\\d{2,3}|black|white)(?=[\\s"'\`/])`,
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

it('uses colour tokens, never raw palette classes', () => {
  const found = ROOTS.flatMap(files).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => {
        const m = RAW.exec(line);
        return m ? [`${file}:${i + 1}: ${m[0]}`] : [];
      }),
  );
  assert.deepEqual(found, []);
});

it('catches raw palette classes (sanity check of the pattern)', () => {
  for (const bad of [
    '"fill-amber-400 x"',
    "'bg-black/80'",
    '"x text-white"',
    '"dark:bg-emerald-950"',
    '"hover:text-rose-500"',
  ])
    assert.match(bad, RAW, bad);
  for (const good of [
    '"fill-rating"',
    '"bg-scrim/80"',
    '"text-scrim-foreground"',
    '"bg-success/10"',
  ])
    assert.doesNotMatch(good, RAW, good);
});
