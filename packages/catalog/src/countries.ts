/*
 * Countries the marketplace serves (ADR-0032, ADR-0040). Configuration, not code: a new country is a new
 * entry here, its places (places.ts) and its taxonomy (categories.ts). Zod-free, so the app can import it.
 */

export type Locale = 'nb' | 'en' | 'so';

/** The countries served. Adding one: an entry below, its places and its taxonomy. */
export type CountryCode = 'XS' | 'NO';

export interface PriceBucket {
  /** Stable key, used by the price facet and its labels. */
  key: string;
  /** Major units, inclusive. */
  from?: number;
  /** Major units, exclusive. */
  to?: number;
}

export interface Country {
  /** ISO 3166-1 alpha-2, or a user-assigned code (Somaliland: XS, ADR-0033). */
  code: CountryCode;
  /** ISO 4217 code of the currency listings are priced in. */
  currency: string;
  /** Digits after the decimal point: amounts are stored in minor units (cents, øre). */
  currencyDigits: number;
  /** Languages offered, the default first. */
  locales: readonly Locale[];
  timeZone: string;
  /** E.164 country calling code. */
  phonePrefix: string;
  /** The price facet's buckets, in major units. */
  priceBuckets: readonly PriceBucket[];
  /**
   * How people prove their identity here (ADR-0018), or null where no provider exists yet: the
   * website and the app then offer no verification and show no "not verified".
   */
  identityVerification: 'bankid' | null;
}

export const COUNTRIES: Readonly<Record<CountryCode, Country>> = {
  XS: {
    code: 'XS',
    currency: 'USD',
    currencyDigits: 2,
    locales: ['en', 'so'],
    timeZone: 'Africa/Hargeisa',
    phonePrefix: '+252',
    identityVerification: null,
    priceBuckets: [
      { key: '0-49', to: 50 },
      { key: '50-199', from: 50, to: 200 },
      { key: '200-999', from: 200, to: 1000 },
      { key: '1000-9999', from: 1000, to: 10_000 },
      { key: '10000+', from: 10_000 },
    ],
  },
  NO: {
    code: 'NO',
    currency: 'NOK',
    currencyDigits: 2,
    locales: ['nb', 'en', 'so'],
    timeZone: 'Europe/Oslo',
    phonePrefix: '+47',
    identityVerification: 'bankid',
    priceBuckets: [
      { key: '0-999', to: 1000 },
      { key: '1000-9999', from: 1000, to: 10_000 },
      { key: '10000-99999', from: 10_000, to: 100_000 },
      { key: '100000-999999', from: 100_000, to: 1_000_000 },
      { key: '1000000+', from: 1_000_000 },
    ],
  },
};
export const COUNTRY_CODES = Object.keys(COUNTRIES) as [CountryCode, ...CountryCode[]];

export function isCountry(code: unknown): code is CountryCode {
  return typeof code === 'string' && Object.hasOwn(COUNTRIES, code);
}

export function country(code: CountryCode): Country {
  return COUNTRIES[code];
}

/** Every price bucket key of every country (the search API's price facet answers with these). */
export const PRICE_BUCKET_KEYS = [
  ...new Set(Object.values(COUNTRIES).flatMap((c) => c.priceBuckets.map((b) => b.key))),
];
