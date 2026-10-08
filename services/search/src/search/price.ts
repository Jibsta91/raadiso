import { ALL_ATTRIBUTES, compareRuleOf, type CompareRule } from '@raadi/catalog';

/*
 * Price insight (ADR-0043): what comparable active listings cost, and how a price compares. Comparable is
 * the taxonomy's rule (same make and model, year within two, per square metre in the region, …), loosened
 * to the subcategory when it finds too few.
 */

export type DealRating = 'unusually_low' | 'great' | 'good' | 'fair' | 'high';
export type PriceUnit = 'listing' | 'areaM2' | 'head';

/** Fewer comparables than this give no statistics. */
export const MIN_COMPARABLES = 4;

export interface PriceStats {
  comparables: number;
  /** Percentiles of the unit price, in minor units. */
  p25: number;
  median: number;
  p75: number;
  unit: PriceUnit;
  /** What had to match: detail keys, near keys, and whether the region did. */
  basis: { same: string[]; near: string[]; region: boolean; loosened: boolean };
}

/** What a listing (or a draft in the form) is, as far as comparing prices goes. */
export interface PriceTarget {
  id?: string;
  country: string;
  category: string;
  subcategory: string;
  region?: string;
  attributes: Record<string, unknown>;
}

/** How a unit price compares with the statistics. */
export function rate(unitPrice: number, s: Pick<PriceStats, 'p25' | 'median' | 'p75'>): DealRating {
  if (unitPrice < 0.5 * s.median) return 'unusually_low';
  if (unitPrice <= s.p25) return 'great';
  if (unitPrice <= s.median) return 'good';
  if (unitPrice <= s.p75) return 'fair';
  return 'high';
}

/** The price per unit (minor units), or undefined if the listing lacks what the unit needs. */
export function unitPrice(
  amountMinor: number,
  unit: PriceUnit,
  attributes: Record<string, unknown>,
): number | undefined {
  if (unit === 'listing') return amountMinor;
  const n = Number(attributes[unit]);
  return Number.isFinite(n) && n > 0 ? amountMinor / n : undefined;
}

/**
 * How far the comparison is loosened when it finds too few: 0 is the rule, 1 keeps the subcategory and
 * the region, 2 the subcategory alone.
 */
export type Looseness = 0 | 1 | 2;
export const LOOSENESS: readonly Looseness[] = [0, 1, 2];

/** The OpenSearch filters for a target's comparables at a level of looseness. */
export function comparableFilters(t: PriceTarget, rule: CompareRule, level: Looseness): object[] {
  const loose = level > 0;
  const filter: object[] = [
    { term: { status: 'active' } },
    { term: { country: t.country } },
    { term: { subcategory: t.subcategory } },
    { exists: { field: 'priceMinor' } },
  ];
  if (rule.per) filter.push({ range: { [`attributes.${rule.per}`]: { gt: 0 } } });
  if (rule.region && t.region && level < 2) filter.push({ term: { region: t.region } });
  if (!loose) {
    for (const key of rule.same ?? []) {
      const v = t.attributes[key];
      if (v === undefined || v === '') continue;
      // Text details (make, model) are indexed in lower case.
      const value = ALL_ATTRIBUTES.get(key)?.kind === 'text' ? String(v).toLowerCase() : v;
      filter.push({ term: { [`attributes.${key}`]: value } });
    }
    for (const [key, within] of Object.entries(rule.near ?? {})) {
      const v = Number(t.attributes[key]);
      if (Number.isFinite(v))
        filter.push({ range: { [`attributes.${key}`]: { gte: v - within, lte: v + within } } });
    }
  }
  return filter;
}

/** The search body for one comparable group: percentiles of the unit price, no hits. */
export function statsBody(t: PriceTarget, level: Looseness): object {
  const rule = compareRuleOf(t.category, t.subcategory);
  const filter = comparableFilters(t, rule, level);
  const unit = rule.per;
  return {
    size: 0,
    track_total_hits: true,
    query: {
      bool: { filter, ...(t.id ? { must_not: [{ ids: { values: [t.id] } }] } : {}) },
    },
    aggs: {
      price: {
        percentiles: {
          ...(unit
            ? {
                script: {
                  lang: 'painless',
                  source: `doc['priceMinor'].value / (double) doc['attributes.${unit}'].value`,
                },
              }
            : { field: 'priceMinor' }),
          percents: [25, 50, 75],
        },
      },
    },
  };
}

/** Reads a statistics response; undefined when there are too few comparables. */
export function readStats(
  t: PriceTarget,
  level: Looseness,
  res: { hits: { total: { value: number } }; aggregations?: Record<string, unknown> },
): PriceStats | undefined {
  const n = res.hits.total.value;
  if (n < MIN_COMPARABLES) return undefined;
  const values = (res.aggregations?.price as { values: Record<string, number | null> } | undefined)
    ?.values;
  const at = (p: string) => values?.[p] ?? values?.[`${p}.0`] ?? null;
  const [p25, median, p75] = [at('25'), at('50'), at('75')];
  if (p25 === null || median === null || p75 === null) return undefined;
  const rule = compareRuleOf(t.category, t.subcategory);
  return {
    comparables: n,
    p25: Math.round(p25),
    median: Math.round(median),
    p75: Math.round(p75),
    unit: rule.per ?? 'listing',
    basis: {
      same: level ? [] : (rule.same ?? []).filter((k) => t.attributes[k] !== undefined),
      near: level ? [] : Object.keys(rule.near ?? {}).filter((k) => t.attributes[k] !== undefined),
      region: Boolean(rule.region && t.region && level < 2),
      loosened: level > 0,
    },
  };
}

/** A key per comparable group, for caching statistics across listings that share it. */
export function groupKey(t: PriceTarget, level: Looseness): string {
  const rule = compareRuleOf(t.category, t.subcategory);
  return JSON.stringify(comparableFilters({ ...t, id: undefined }, rule, level));
}
