import 'server-only';
import { COUNTRIES, type Country, type CountryCode, isCountry } from '@raadi/catalog/countries';
import { headers } from 'next/headers';
import { cache } from 'react';
import { env } from './env';

/**
 * True on the admin console's host (admin.<domain>, ADR-0028). The admin host has its own
 * session (admin-bff, cookie raadi_admin_sid) and shows only the /<locale>/admin area.
 */
export const isAdminHost = cache(async (): Promise<boolean> =>
  ((await headers()).get('host') ?? '').startsWith('admin.'),
);

/**
 * The country a host serves (ADR-0040): COUNTRY_HOSTS names hosts ("raadiso.com=XS"); a subdomain
 * (admin., dev.) belongs to its parent's country; anything else gets DEFAULT_COUNTRY.
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

/** The country of this request. */
export const currentCountry = cache(async (): Promise<CountryCode> =>
  countryForHost((await headers()).get('host') ?? '', env.countryHosts, env.defaultCountry),
);

/** The country of this request, with its currency, languages and price buckets. */
export const currentCountryConfig = cache(
  async (): Promise<Country> => COUNTRIES[await currentCountry()],
);
