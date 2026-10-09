import { COUNTRIES, type CountryCode, isCountry } from '@raadi/catalog/countries';

/**
 * The country a host serves (ADR-0040): COUNTRY_HOSTS names hosts ("raadiso.com=XS"); a subdomain
 * (admin., dev.) belongs to its parent's country; anything else gets DEFAULT_COUNTRY. Pure, so the
 * proxy can use it too.
 */
export function countryForHost(host: string, hosts: string, fallback: string): CountryCode {
  const name = host.toLowerCase().replace(/:\d+$/, '');
  const pairs = hosts
    .split(',')
    .map((pair) => pair.split('=').map((s) => s.trim().toLowerCase()))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0])
    .sort(([a], [b]) => b.length - a.length);
  for (const [h, code] of pairs) {
    const upper = code.toUpperCase();
    if ((name === h || name.endsWith(`.${h}`)) && isCountry(upper)) return upper;
  }
  return isCountry(fallback) ? fallback : 'XS';
}

/** The languages a country's site offers, its default first (ADR-0053). */
export function countryLocales(code: CountryCode): { locales: string[]; defaultLocale: string } {
  const locales = [...COUNTRIES[code].locales];
  return { locales, defaultLocale: locales[0]! };
}
