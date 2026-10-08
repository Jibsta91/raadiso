import { formatMoney, type Money } from '@raadi/catalog/money';

/** "$1,250" (en, USD), "1 350 kr" (nb, NOK): the listing's currency, the reader's format (ADR-0040). */
export function formatPrice(price: Money, locale: string): string {
  return formatMoney(price, locale);
}

/** Search params as a flat record (Next.js gives string | string[] | undefined). */
export function flatParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v] as const)
      .filter((e): e is readonly [string, string] => typeof e[1] === 'string' && e[1] !== ''),
  );
}

/** Builds a query string from a record, dropping empty values. */
export function toQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Car makes are indexed lower-case; show them the way people write them (BMW, Volvo). */
export function makeLabel(make: string): string {
  return make.length <= 3 ? make.toUpperCase() : make.charAt(0).toUpperCase() + make.slice(1);
}
