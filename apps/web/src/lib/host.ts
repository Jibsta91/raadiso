import 'server-only';
import { COUNTRIES, type Country, type CountryCode } from '@raadi/catalog/countries';
import { headers } from 'next/headers';
import { cache } from 'react';
import { countryForHost, countryLocales } from './country-host';
import { env } from './env';

/**
 * True on the admin console's host (admin.<domain>, ADR-0028). The admin host has its own
 * session (admin-bff, cookie raadi_admin_sid) and shows only the /<locale>/admin area.
 */
export const isAdminHost = cache(async (): Promise<boolean> =>
  ((await headers()).get('host') ?? '').startsWith('admin.'),
);

export { countryForHost } from './country-host';

/** The country of this request. */
export const currentCountry = cache(async (): Promise<CountryCode> =>
  countryForHost((await headers()).get('host') ?? '', env.countryHosts, env.defaultCountry),
);

/** The country of this request, with its currency, languages and price buckets. */
export const currentCountryConfig = cache(
  async (): Promise<Country> => COUNTRIES[await currentCountry()],
);

/** The languages this request's country offers, its default first (ADR-0053). */
export const currentLocales = cache(async () => countryLocales(await currentCountry()));
