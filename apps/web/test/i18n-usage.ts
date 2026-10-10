// Static analysis of how the source uses next-intl, shared by messages-usage.test.ts and
// client-messages.test.ts. It reads translator bindings (useTranslations / getTranslations, alone or
// inside `await Promise.all([...])`) and the keys each translator is called with. A key written as a
// literal is exact; a template literal gives its static prefix; anything else (a variable, the
// translator handed on to another function) counts as the translator's whole namespace.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

export type Tree = { [k: string]: string | Tree };
export const loadMessages = (locale: string): Tree =>
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));

/** The node at a dotted path, or undefined. */
export function at(tree: Tree, path: string): Tree | string | undefined {
  return path
    .split('.')
    .reduce<Tree | string | undefined>(
      (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
      tree,
    );
}

export interface Use {
  file: string;
  line: number;
  /** The full dotted path: a key (exact) or a subtree (prefix). */
  path: string;
  exact: boolean;
  /** t.has(): the key may be missing on purpose. */
  optional: boolean;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

export const FILES: Map<string, string> = new Map(
  walk(SRC).map((f) => [f, readFileSync(f, 'utf8')]),
);

/** Splits `a, b(c, d), [e]` at top-level commas. */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** The text between an opening bracket at `start` and its match. */
function balanced(s: string, start: number): string {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if ('([{'.includes(s[i]!)) depth++;
    if (')]}'.includes(s[i]!)) depth--;
    if (depth === 0) return s.slice(start + 1, i);
  }
  return s.slice(start + 1);
}

const TRANSLATOR =
  /^(?:await\s+)?(?:get|use)Translations\(\s*(?:'([^']*)'|\{[^}]*?namespace:\s*'([^']*)'[^}]*\}|\{[^}]*\})?\s*\)$/;

/** Translator variables of a file: name, namespace ('' for the root) and where they are bound. */
export function bindings(source: string): Array<{ name: string; ns: string; index: number }> {
  const found: Array<{ name: string; ns: string; index: number }> = [];
  for (const m of source.matchAll(
    /const\s+(\w+)\s*=\s*((?:await\s+)?(?:get|use)Translations\([^)]*\))/g,
  )) {
    const t = TRANSLATOR.exec(m[2]!.trim());
    if (t) found.push({ name: m[1]!, ns: t[1] ?? t[2] ?? '', index: m.index! });
  }
  for (const m of source.matchAll(/const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\(\s*\[/g)) {
    const names = splitTop(m[1]!);
    const items = splitTop(balanced(source, m.index! + m[0].length - 1));
    names.forEach((name, i) => {
      const t = TRANSLATOR.exec(items[i] ?? '');
      if (t && /^\w+$/.test(name)) found.push({ name, ns: t[1] ?? t[2] ?? '', index: m.index! });
    });
  }
  return found.sort((a, b) => a.index - b.index);
}

const join2 = (ns: string, key: string) => (ns && key ? `${ns}.${key}` : ns || key);

/**
 * Every use of a translator in one file. A file may bind the same name in several functions; a use
 * belongs to the nearest binding before it.
 */
export function usesIn(file: string, source: string): Use[] {
  const uses: Use[] = [];
  const lineOf = (index: number) => source.slice(0, index).split('\n').length;
  const bound = bindings(source);
  for (const name of new Set(bound.map((b) => b.name))) {
    const ref = new RegExp(`(?<![\\w.])${name}\\b(\\.(?:rich|markup|has|raw))?(\\s*\\()?`, 'g');
    for (const m of source.matchAll(ref)) {
      const ns = bound.filter((b) => b.name === name && b.index < m.index!).at(-1)?.ns;
      if (ns === undefined) continue;
      const after = source.slice(m.index! + m[0].length);
      const before = source.slice(0, m.index!);
      // The binding itself (`const t =`, `const [t, format] =`) and object keys (`{ t: … }`) are not uses.
      if (/(?:const|let)\s+$/.test(before) || /const\s*\[[^\]]*$/.test(before)) continue;
      const line = lineOf(m.index!);
      const optional = m[1] === '.has';
      if (!m[2]) {
        if (m[1] || /^\s*:/.test(after) || /^\s*=>/.test(after)) continue;
        // Handed on (a prop, a helper): it may read anything in its namespace.
        uses.push({ file, line, path: ns, exact: false, optional });
        continue;
      }
      const lit = /^\s*'([^'\n]*)'/.exec(after) ?? /^\s*"([^"\n]*)"/.exec(after);
      if (lit) {
        uses.push({ file, line, path: join2(ns, lit[1]!), exact: true, optional });
        continue;
      }
      const tpl = /^\s*`([^`]*)`/.exec(after);
      if (tpl) {
        const raw = tpl[1]!;
        const cut = raw.indexOf('${');
        if (cut === -1) uses.push({ file, line, path: join2(ns, raw), exact: true, optional });
        else {
          const prefix = raw.slice(0, cut).replace(/\.?[^.]*$/, '');
          uses.push({ file, line, path: join2(ns, prefix), exact: false, optional });
        }
        continue;
      }
      uses.push({ file, line, path: ns, exact: false, optional });
    }
  }
  return uses;
}

export const ALL_USES: Use[] = [...FILES].flatMap(([file, source]) => usesIn(file, source));

// ---- the import graph, for what reaches the browser ------------------------------------------

function resolveImport(from: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = normalize(join(dirname(from), spec));
  else return undefined;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx'])
    if (FILES.has(base + ext)) return base + ext;
  return undefined;
}

export const IMPORTS: Map<string, string[]> = new Map(
  [...FILES].map(([file, source]) => [
    file,
    [...source.matchAll(/(?:import|export)\s[^'";]*?from\s+'([^']+)'|import\('([^']+)'\)/g)]
      .map((m) => resolveImport(file, m[1] ?? m[2]!))
      .filter((f): f is string => !!f),
  ]),
);

const isClientEntry = (source: string) => /^\s*['"]use client['"]/.test(source);

/** Files that run in the browser: 'use client' modules and everything they import. */
export const CLIENT_FILES: Set<string> = (() => {
  const out = new Set<string>();
  const stack = [...FILES].filter(([, s]) => isClientEntry(s)).map(([f]) => f);
  while (stack.length) {
    const f = stack.pop()!;
    if (out.has(f)) continue;
    out.add(f);
    stack.push(...(IMPORTS.get(f) ?? []));
  }
  return out;
})();

/** Every file a page reaches through imports, itself included. */
export function reach(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...(IMPORTS.get(f) ?? []));
  }
  return seen;
}

export const rel = (file: string) => relative(SRC, file);

/** True when `need` lies inside one of the `provided` paths. */
export const covered = (need: string, provided: readonly string[]) =>
  provided.some((p) => p === '' || need === p || need.startsWith(`${p}.`));
