import {
  attributesOf,
  categoriesOf,
  CHEAP_WORDS,
  type CountryCode,
  COUNTRIES,
  FILLER_WORDS,
  HINT_WORDS,
  isSubcategoryOf,
  MAX_PRICE_WORDS,
  MIN_PRICE_WORDS,
  NODE_WORDS,
  parentOf,
  placeName,
  placesOf,
  REGIONS,
  type SearchParams,
  VALUE_WORDS,
  type Words,
} from '@raadi/catalog';

/*
 * Query understanding (ADR-0041): "cheap toyota hargeisa under 5000" becomes cars near Hargeisa, at most
 * $5,000, cheapest first, with "toyota" left as text. Deterministic, from the catalog's lexicon and
 * gazetteer only. The longest phrase wins; a category beats a place of the same name (Ski the sport, not
 * Ski the town); only what the request didn't set itself is applied.
 */

/** One recognised part of the query, for the response (the website shows it as a removable chip). */
export interface Understood {
  kind: 'category' | 'attribute' | 'place' | 'region' | 'sort' | 'price';
  /** The words of the query it came from, as typed. */
  words: string;
  /** The search parameters it set (removing the chip removes them all). */
  set: Record<string, string>;
}

export interface Understanding {
  /** The parameters to search with: the request's, plus what the query said. */
  params: SearchParams;
  /** The words left for full-text search ("" when every word was understood). */
  text: string;
  understood: Understood[];
  /** Category and subcategory ids named in the query but not applied (boosted instead). */
  boostCategories: string[];
  /** Attribute values named but not applied, as `attributes.<key>` → values (boosted instead). */
  boostValues: Record<string, string[]>;
}

type Meaning =
  | { kind: 'node'; id: string; keep?: boolean }
  | { kind: 'value'; key: string; value: string; also?: string }
  | { kind: 'place'; id: string }
  | { kind: 'region'; id: string }
  | { kind: 'cheap' }
  | { kind: 'max' }
  | { kind: 'min' }
  | { kind: 'filler' };

/** Lower case without accents; æ, ø and å as people type them without a Norwegian keyboard. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
}

/** Words of a query: letters, digits and apostrophes (lo'), and numbers with separators (5,000). */
export function tokens(s: string): Array<{ raw: string; key: string }> {
  return [...s.matchAll(/\d+(?:[.,]\d+)*k?|[\p{L}\p{N}']+/giu)].map((m) => ({
    raw: m[0],
    key: fold(m[0]),
  }));
}

const phraseKey = (s: string) =>
  tokens(s)
    .map((t) => t.key)
    .join(' ');

/** The longest phrase in any lexicon entry, in words. */
const MAX_PHRASE = 4;

const lexicons = new Map<CountryCode, Map<string, Meaning[]>>();

/** The attribute keys a country's taxonomy has. */
const keysOf = (country: CountryCode) =>
  new Set(categoriesOf(country).flatMap((r) => attributesOf(r.id).map((a) => a.key)));

/** Every phrase of the country's languages and what it means. Built once per country. */
export function lexicon(country: CountryCode): Map<string, Meaning[]> {
  const cached = lexicons.get(country);
  if (cached) return cached;
  const { locales } = COUNTRIES[country];
  const map = new Map<string, Meaning[]>();
  const put = (key: string, meaning: Meaning) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    if (!list.some((m) => JSON.stringify(m) === JSON.stringify(meaning))) list.push(meaning);
    map.set(key, list);
  };
  const add = (words: Words | undefined, meaning: Meaning) => {
    for (const locale of locales) for (const w of words?.[locale] ?? []) put(phraseKey(w), meaning);
  };
  const roots = categoriesOf(country);
  const nodes = roots.flatMap((r) => [r.id, ...(r.children ?? []).map((c) => c.id)]);
  for (const id of nodes) add(NODE_WORDS[id], { kind: 'node', id });
  for (const id of nodes) add(HINT_WORDS[id], { kind: 'node', id, keep: true });
  // Values only for attributes this country's taxonomy has.
  const keys = keysOf(country);
  for (const [key, values] of Object.entries(VALUE_WORDS)) {
    if (!keys.has(key)) continue;
    for (const [value, entry] of Object.entries(values))
      add(entry.words, {
        kind: 'value',
        key,
        value,
        ...(entry.also && nodes.includes(entry.also) ? { also: entry.also } : {}),
      });
  }
  add(CHEAP_WORDS, { kind: 'cheap' });
  add(MAX_PRICE_WORDS, { kind: 'max' });
  add(MIN_PRICE_WORDS, { kind: 'min' });
  add(FILLER_WORDS, { kind: 'filler' });
  for (const place of placesOf(country))
    for (const name of new Set([place.name, ...locales.map((l) => placeName(place, l))]))
      put(phraseKey(name), { kind: 'place', id: place.id });
  for (const [id, name] of Object.entries(REGIONS[country]))
    put(phraseKey(name), { kind: 'region', id });
  lexicons.set(country, map);
  return map;
}

/** "5000", "5,000", "5k", "12.50" → major units; undefined if not an amount. */
export function parseAmount(raw: string): number | undefined {
  const m = /^(\d+(?:[.,]\d+)*)(k)?$/i.exec(raw);
  if (!m) return undefined;
  // "5,000" and "5.000" group thousands; "12.50" and "12,5" are decimals.
  const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(m[1]!);
  const n = Number(grouped ? m[1]!.replace(/[.,]/g, '') : m[1]!.replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  return m[2] ? n * 1000 : n;
}

const CURRENCY_WORD = /^(kr|kroner|usd|dollars?|doollar|shilin)$/i;
const RANGE = /(\d+(?:[.,]\d+)*k?)\s*[-–]\s*(\d+(?:[.,]\d+)*k?)/i;

type Found = { meanings: Meaning[]; raw: string; from: number; to: number };

/** Reads the query and returns the parameters to search with. */
export function understand(p: SearchParams, country: CountryCode): Understanding {
  const result: Understanding = {
    params: { ...p },
    text: '',
    understood: [],
    boostCategories: [],
    boostValues: {},
  };
  if (!p.q) return result;
  const params = result.params as Record<string, unknown>;
  const free = (param: string) => params[param] === undefined || params[param] === '';
  let q = p.q;

  // A price range first ("500-1000", "$5k–10k"), before the words are split.
  const range = RANGE.exec(q);
  if (range) {
    const [min, max] = [parseAmount(range[1]!), parseAmount(range[2]!)];
    if (
      min !== undefined &&
      max !== undefined &&
      min <= max &&
      free('priceMin') &&
      free('priceMax')
    ) {
      params.priceMin = min;
      params.priceMax = max;
      result.understood.push({
        kind: 'price',
        words: range[0],
        set: { priceMin: String(min), priceMax: String(max) },
      });
      q = q.replace(range[0], ' ');
    }
  }

  const words = tokens(q);
  const map = lexicon(country);
  const found: Found[] = [];
  for (let i = 0; i < words.length;) {
    let n = Math.min(MAX_PHRASE, words.length - i);
    for (; n >= 1; n--) {
      const key = words
        .slice(i, i + n)
        .map((w) => w.key)
        .join(' ');
      const meanings = map.get(key);
      if (!meanings) continue;
      const raw = words
        .slice(i, i + n)
        .map((w) => w.raw)
        .join(' ');
      found.push({ meanings, raw, from: i, to: i + n });
      break;
    }
    i += Math.max(n, 1);
  }
  /** Word positions that end up neither applied nor kept as text. */
  const dropped = new Set<number>();
  const drop = (f: Found) => {
    for (let k = f.from; k < f.to; k++) dropped.add(k);
  };

  // A price after a price word: "under 5000", "ilaa 500 dollar", "over 2k".
  for (const f of found) {
    const bound = f.meanings.find((m) => m.kind === 'max' || m.kind === 'min');
    if (!bound) continue;
    const amount = words[f.to] ? parseAmount(words[f.to]!.raw) : undefined;
    if (amount === undefined) {
      drop(f);
      continue;
    }
    const param = bound.kind === 'max' ? 'priceMax' : 'priceMin';
    drop(f);
    dropped.add(f.to);
    if (words[f.to + 1] && CURRENCY_WORD.test(words[f.to + 1]!.raw)) dropped.add(f.to + 1);
    if (free(param)) {
      params[param] = amount;
      result.understood.push({
        kind: 'price',
        words: `${f.raw} ${words[f.to]!.raw}`,
        set: { [param]: String(amount) },
      });
    }
  }

  // Categories: applied when everything named belongs to one category; otherwise boosted.
  const named = found.flatMap((f) =>
    f.meanings.flatMap((m) => (m.kind === 'node' ? [{ id: m.id, f, keep: m.keep === true }] : [])),
  );
  const implied = found.flatMap((f) =>
    f.meanings.some((m) => m.kind === 'node')
      ? []
      : f.meanings.flatMap((m) =>
          m.kind === 'value' && m.also ? [{ id: m.also, f, keep: false }] : [],
        ),
  );
  const nodes = [...named, ...implied];
  const roots = new Set(nodes.map((n) => parentOf(n.id) ?? n.id));
  const requested = p.category?.length ? p.category : undefined;
  if (nodes.length && roots.size === 1 && !requested) {
    const chosen = nodes.find((n) => parentOf(n.id)) ?? nodes[0]!;
    const root = parentOf(chosen.id) ?? chosen.id;
    const set: Record<string, string> = { category: root };
    params.category = [root];
    if (parentOf(chosen.id) && !p.subcategory?.length) {
      params.subcategory = [chosen.id];
      set.subcategory = chosen.id;
    }
    result.understood.push({ kind: 'category', words: chosen.f.raw, set });
    for (const n of named) if (!n.keep) drop(n.f);
  } else {
    // In a category the request chose, words naming another one stay text; otherwise they boost.
    for (const n of named) {
      result.boostCategories.push(n.id);
      if (!n.keep && (!requested || requested.includes(parentOf(n.id) ?? n.id))) drop(n.f);
    }
  }

  // Attribute values: applied where the category in force has the attribute, else boosted.
  const category =
    (params.category as string[] | undefined)?.length === 1
      ? (params.category as string[])[0]
      : undefined;
  const sub = (params.subcategory as string[] | undefined)?.[0];
  const attrs = category
    ? attributesOf(category, sub && isSubcategoryOf(category, sub) ? sub : undefined)
    : [];
  for (const f of found) {
    for (const m of f.meanings) {
      if (m.kind !== 'value') continue;
      drop(f);
      if (attrs.some((a) => a.key === m.key) && free(m.key)) {
        params[m.key] = [m.value];
        result.understood.push({ kind: 'attribute', words: f.raw, set: { [m.key]: m.value } });
      } else {
        (result.boostValues[`attributes.${m.key}`] ??= []).push(m.value);
      }
    }
  }

  // Place or region: the first one, unless the request has a location already. A word that is also
  // a category (Ski) was a category.
  const located = p.near || p.lat !== undefined || p.region?.length;
  for (const f of found) {
    if (located || f.meanings.some((m) => m.kind === 'node')) continue;
    const place = f.meanings.find((m) => m.kind === 'place');
    const region = f.meanings.find((m) => m.kind === 'region');
    if (place?.kind === 'place') {
      params.near = place.id;
      result.understood.push({ kind: 'place', words: f.raw, set: { near: place.id } });
    } else if (region?.kind === 'region') {
      params.region = [region.id];
      result.understood.push({ kind: 'region', words: f.raw, set: { region: region.id } });
    } else continue;
    drop(f);
    break;
  }

  // "Cheap": cheapest first, when no explicit order was asked for.
  const cheap = found.find((f) => f.meanings.some((m) => m.kind === 'cheap'));
  if (cheap) {
    drop(cheap);
    if (p.sort === 'relevance') {
      params.sort = 'price_asc';
      result.understood.push({ kind: 'sort', words: cheap.raw, set: { sort: 'price_asc' } });
    }
  }
  for (const f of found) if (f.meanings.every((m) => m.kind === 'filler')) drop(f);

  result.text = words
    .filter((_, i) => !dropped.has(i))
    .map((w) => w.raw)
    .join(' ')
    .trim();
  params.q = result.text || undefined;
  return result;
}
