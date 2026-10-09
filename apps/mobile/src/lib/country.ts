import { COUNTRIES, type CountryCode, isCountry } from '@raadi/catalog/countries';

/**
 * The marketplace this build of the app serves (ADR-0040): EXPO_PUBLIC_COUNTRY, else Norway, the
 * development stack's country until the website's Somaliland slice reaches the app.
 */
export const APP_COUNTRY: CountryCode = isCountry(process.env.EXPO_PUBLIC_COUNTRY)
  ? process.env.EXPO_PUBLIC_COUNTRY
  : 'NO';

/** The languages this build offers, its country's default first (ADR-0053). */
export const APP_LOCALES = COUNTRIES[APP_COUNTRY].locales;
