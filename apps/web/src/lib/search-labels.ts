import 'server-only';
import {
  ALL_ATTRIBUTES,
  COUNTRIES,
  findPlace,
  isCountry,
  regionName,
  SAVED_SEARCH_EXCLUDED,
} from '@raadi/catalog';
import { currencySymbol } from '@raadi/catalog/money';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { makeLabel } from './format';
import { currentCountry } from './host';
import { CATEGORY_FILTERS, type Params } from './search-params';

/** Units of range filters, from the taxonomy (km, m², GB). */
const UNITS: Record<string, string> = Object.fromEntries(
  [...ALL_ATTRIBUTES.values()].flatMap((a) =>
    a.kind === 'number' && a.range && a.unit ? [[a.range, a.unit] as const] : [],
  ),
);

/**
 * A search in words, in the visitor's language: one label per filter value
 * ("Bil", "Personbiler", "Elektrisk", "Årsmodell fra 2018"). Used to name saved
 * searches and to show what they contain.
 */
export async function searchLabels(params: Params): Promise<string[]> {
  const [t, format, locale, here] = await Promise.all([
    getTranslations(),
    getFormatter(),
    getLocale(),
    currentCountry(),
  ]);
  const country = isCountry(params.country) ? params.country : here;
  const units = { ...UNITS, price: currencySymbol(COUNTRIES[country].currency, locale) };
  const values = (key: string) => (params[key] ?? '').split(',').filter(Boolean);
  const labels: string[] = [];
  if (params.q) labels.push(`«${params.q}»`);
  for (const v of values('category')) labels.push(t(`taxonomy.categories.${v}` as never));
  for (const v of values('subcategory')) labels.push(t(`taxonomy.subcategories.${v}` as never));
  for (const v of values('region')) labels.push(regionName(v));
  for (const key of CATEGORY_FILTERS) {
    if (/(Min|Max)$/.test(key)) continue;
    for (const v of values(key))
      labels.push(key === 'make' ? makeLabel(v) : t(`taxonomy.values.${key}.${v}` as never));
  }
  for (const [key, value] of Object.entries(params)) {
    const m = /^(.+)(Min|Max)$/.exec(key);
    if (!m || SAVED_SEARCH_EXCLUDED.includes(key)) continue;
    const [, name, which] = m as unknown as [string, string, 'Min' | 'Max'];
    const title = name === 'price' ? t('search.price') : t(`search.ranges.${name}` as never);
    const n = name === 'year' ? value : format.number(Number(value));
    const unit = units[name as keyof typeof units];
    labels.push(
      t(which === 'Min' ? 'search.rangeFrom' : 'search.rangeTo', {
        filter: title,
        value: unit ? `${n} ${unit}` : n,
      }),
    );
  }
  if (params.near) {
    labels.push(
      t('savedSearches.near', {
        place: findPlace(params.near)?.name ?? params.near,
        km: params.radiusKm ?? '50',
      }),
    );
  } else if (params.lat) {
    labels.push(t('search.nearMe'));
  }
  return labels;
}

/** What a saved search keeps: the filters, without paging, sorting or empty values. */
export function savedParams(params: Params): Params {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([k, v]) => !SAVED_SEARCH_EXCLUDED.includes(k) && v !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export const sameSearch = (a: Params, b: Params) =>
  JSON.stringify(savedParams(a)) === JSON.stringify(savedParams(b));
