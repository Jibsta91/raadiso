import { FACET_KEYS, RANGE_PARAMS } from '@raadi/catalog/categories';

/** Helpers for building search URLs from the current (flat) query. */
export type Params = Record<string, string>;

/** Filters that only make sense inside one category (attribute facets and ranges). */
export const CATEGORY_FILTERS = [
  ...new Set([...FACET_KEYS, ...RANGE_PARAMS.flatMap((p) => [`${p}Min`, `${p}Max`])]),
];

export function toggleValue(params: Params, key: string, value: string): Params {
  const current = (params[key] ?? '').split(',').filter(Boolean);
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const { page: _page, ...rest } = params;
  // Changing the category invalidates subcategory and category-specific facets.
  if (key === 'category') {
    delete rest.subcategory;
    for (const k of CATEGORY_FILTERS) delete rest[k];
  }
  return next.length ? { ...rest, [key]: next.join(',') } : withoutKey(rest, key);
}

export function withParams(params: Params, changes: Record<string, string | undefined>): Params {
  const { page: _page, ...rest } = params;
  const next: Params = { ...rest };
  for (const [k, v] of Object.entries(changes)) {
    if (v) next[k] = v;
    else delete next[k];
  }
  return next;
}

export function withoutKey(params: Params, key: string): Params {
  const { [key]: _drop, ...rest } = params;
  return rest;
}

export function href(params: Params): string {
  const q = new URLSearchParams(params).toString();
  return q ? `/search?${q}` : '/search';
}

export function selected(params: Params, key: string): string[] {
  return (params[key] ?? '').split(',').filter(Boolean);
}
