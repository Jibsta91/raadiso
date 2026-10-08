import type { CountryCode, Locale } from './countries.js';

/**
 * Offline gazetteer per country (ADR-0040): towns with approximate centre coordinates (WGS84), each in
 * a region of its country. A listing references a place by id, and its country and region follow from
 * the place. Geo-radius search resolves a place to coordinates without any external geocoding service.
 * Place ids are unique across countries.
 */
export const REGIONS = {
  XS: {
    // Somaliland's six regions as most people know them. Disputed areas are left out until the owner
    // decides how to show them (ADR-0033).
    'maroodi-jeex': 'Maroodi Jeex',
    awdal: 'Awdal',
    saaxil: 'Saaxil',
    togdheer: 'Togdheer',
    sanaag: 'Sanaag',
    sool: 'Sool',
  },
  NO: {
    oslo: 'Oslo',
    akershus: 'Akershus',
    ostfold: 'Østfold',
    buskerud: 'Buskerud',
    vestfold: 'Vestfold',
    telemark: 'Telemark',
    agder: 'Agder',
    rogaland: 'Rogaland',
    vestland: 'Vestland',
    'more-og-romsdal': 'Møre og Romsdal',
    trondelag: 'Trøndelag',
    innlandet: 'Innlandet',
    nordland: 'Nordland',
    troms: 'Troms',
    finnmark: 'Finnmark',
  },
} as const satisfies Record<CountryCode, Record<string, string>>;

export type Region = { [C in CountryCode]: keyof (typeof REGIONS)[C] }[CountryCode];

/** Every region key of every country (search's region facet). */
export const REGION_KEYS: readonly string[] = Object.values(REGIONS).flatMap((r) => Object.keys(r));

export interface Place {
  id: string;
  /** The name as most people write it in the country's default language. */
  name: string;
  /** Other spellings people search for (Somali "Hargeysa" for Hargeisa). */
  names?: Partial<Record<Locale, string>>;
  country: CountryCode;
  region: Region;
  lat: number;
  lon: number;
}

const xs = (
  id: string,
  name: string,
  so: string,
  region: keyof typeof REGIONS.XS,
  lat: number,
  lon: number,
): Place => ({
  id,
  name,
  ...(so !== name ? { names: { so } } : {}),
  country: 'XS',
  region,
  lat,
  lon,
});
const no = (
  id: string,
  name: string,
  region: keyof typeof REGIONS.NO,
  lat: number,
  lon: number,
): Place => ({ id, name, country: 'NO', region, lat, lon });

export const PLACES: readonly Place[] = [
  xs('hargeisa', 'Hargeisa', 'Hargeysa', 'maroodi-jeex', 9.5624, 44.077),
  xs('gabiley', 'Gabiley', 'Gabiley', 'maroodi-jeex', 9.6966, 43.6284),
  xs('arabsiyo', 'Arabsiyo', 'Carabsiyo', 'maroodi-jeex', 9.687, 43.7708),
  xs('wajaale', 'Wajaale', 'Wajaale', 'maroodi-jeex', 9.608, 43.342),
  xs('borama', 'Borama', 'Boorama', 'awdal', 9.9358, 43.183),
  xs('zeila', 'Zeila', 'Saylac', 'awdal', 11.353, 43.473),
  xs('lughaya', 'Lughaya', 'Lughaya', 'awdal', 10.6833, 43.9333),
  xs('berbera', 'Berbera', 'Berbera', 'saaxil', 10.4356, 45.0164),
  xs('sheikh', 'Sheikh', 'Sheekh', 'saaxil', 9.9333, 45.2),
  xs('burao', 'Burao', 'Burco', 'togdheer', 9.5221, 45.5336),
  xs('oodweyne', 'Oodweyne', 'Oodweyne', 'togdheer', 9.409, 45.064),
  xs('erigavo', 'Erigavo', 'Ceerigaabo', 'sanaag', 10.6167, 47.3667),
  xs('el-afweyn', 'El Afweyn', 'Ceel Afweyn', 'sanaag', 9.9267, 47.2167),
  xs('maydh', 'Maydh', 'Maydh', 'sanaag', 10.987, 47.093),
  xs('aynabo', 'Aynabo', 'Caynabo', 'sool', 8.95, 46.4333),
  no('oslo', 'Oslo', 'oslo', 59.9139, 10.7522),
  no('lillestrom', 'Lillestrøm', 'akershus', 59.956, 11.05),
  no('asker', 'Asker', 'akershus', 59.8331, 10.4392),
  no('sandvika', 'Sandvika', 'akershus', 59.8913, 10.524),
  no('ski', 'Ski', 'akershus', 59.7195, 10.8357),
  no('jessheim', 'Jessheim', 'akershus', 60.1416, 11.1747),
  no('fredrikstad', 'Fredrikstad', 'ostfold', 59.2181, 10.9298),
  no('sarpsborg', 'Sarpsborg', 'ostfold', 59.284, 11.1096),
  no('moss', 'Moss', 'ostfold', 59.434, 10.6577),
  no('halden', 'Halden', 'ostfold', 59.1229, 11.3875),
  no('drammen', 'Drammen', 'buskerud', 59.7439, 10.2045),
  no('kongsberg', 'Kongsberg', 'buskerud', 59.6686, 9.6502),
  no('honefoss', 'Hønefoss', 'buskerud', 60.168, 10.2564),
  no('tonsberg', 'Tønsberg', 'vestfold', 59.2675, 10.4076),
  no('sandefjord', 'Sandefjord', 'vestfold', 59.1312, 10.2166),
  no('larvik', 'Larvik', 'vestfold', 59.0533, 10.0352),
  no('skien', 'Skien', 'telemark', 59.2096, 9.609),
  no('porsgrunn', 'Porsgrunn', 'telemark', 59.1405, 9.6561),
  no('notodden', 'Notodden', 'telemark', 59.5594, 9.2585),
  no('kristiansand', 'Kristiansand', 'agder', 58.1599, 8.0182),
  no('arendal', 'Arendal', 'agder', 58.461, 8.7725),
  no('grimstad', 'Grimstad', 'agder', 58.3405, 8.5934),
  no('mandal', 'Mandal', 'agder', 58.0294, 7.4609),
  no('stavanger', 'Stavanger', 'rogaland', 58.97, 5.7331),
  no('sandnes', 'Sandnes', 'rogaland', 58.8517, 5.7355),
  no('haugesund', 'Haugesund', 'rogaland', 59.4138, 5.268),
  no('egersund', 'Egersund', 'rogaland', 58.4513, 5.9997),
  no('bergen', 'Bergen', 'vestland', 60.3913, 5.3221),
  no('voss', 'Voss', 'vestland', 60.628, 6.418),
  no('forde', 'Førde', 'vestland', 61.452, 5.857),
  no('leirvik', 'Leirvik', 'vestland', 59.7795, 5.5005),
  no('alesund', 'Ålesund', 'more-og-romsdal', 62.4722, 6.1495),
  no('molde', 'Molde', 'more-og-romsdal', 62.7375, 7.1591),
  no('kristiansund', 'Kristiansund', 'more-og-romsdal', 63.1105, 7.7279),
  no('trondheim', 'Trondheim', 'trondelag', 63.4305, 10.3951),
  no('steinkjer', 'Steinkjer', 'trondelag', 64.0149, 11.4954),
  no('stjordal', 'Stjørdal', 'trondelag', 63.4691, 10.918),
  no('levanger', 'Levanger', 'trondelag', 63.7464, 11.2996),
  no('hamar', 'Hamar', 'innlandet', 60.7945, 11.068),
  no('lillehammer', 'Lillehammer', 'innlandet', 61.1153, 10.4662),
  no('gjovik', 'Gjøvik', 'innlandet', 60.7957, 10.6916),
  no('elverum', 'Elverum', 'innlandet', 60.8819, 11.5623),
  no('bodo', 'Bodø', 'nordland', 67.2804, 14.4049),
  no('narvik', 'Narvik', 'nordland', 68.4385, 17.4272),
  no('mo-i-rana', 'Mo i Rana', 'nordland', 66.3128, 14.1428),
  no('svolvaer', 'Svolvær', 'nordland', 68.2343, 14.5683),
  no('tromso', 'Tromsø', 'troms', 69.6492, 18.9553),
  no('harstad', 'Harstad', 'troms', 68.7983, 16.5417),
  no('finnsnes', 'Finnsnes', 'troms', 69.2296, 17.9811),
  no('alta', 'Alta', 'finnmark', 69.9689, 23.2716),
  no('hammerfest', 'Hammerfest', 'finnmark', 70.6634, 23.6821),
  no('kirkenes', 'Kirkenes', 'finnmark', 69.7271, 30.045),
  no('vadso', 'Vadsø', 'finnmark', 70.0744, 29.7487),
];

const BY_ID = new Map(PLACES.map((place) => [place.id, place]));

export function findPlace(id: string): Place | undefined {
  return BY_ID.get(id);
}

/** The places of one country, in gazetteer order. */
export function placesOf(code: CountryCode): readonly Place[] {
  return PLACES.filter((place) => place.country === code);
}

/** "Maroodi Jeex"; the key itself for a region the gazetteer doesn't know. */
export function regionName(region: string): string {
  for (const regions of Object.values(REGIONS)) {
    if (Object.hasOwn(regions, region)) return (regions as Record<string, string>)[region]!;
  }
  return region;
}

/** The place's name in a language, falling back to its usual name. */
export function placeName(place: Place, locale: Locale): string {
  return place.names?.[locale] ?? place.name;
}

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
