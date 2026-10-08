/**
 * Deterministic demo dataset (development only, SEED_DEMO_DATA=true).
 *
 * The listings and media seeders run independently in their own services; both
 * derive the same listing and image ids from this module, so they agree without
 * talking to each other. Same input, same output, on every machine.
 */
import { createHash } from 'node:crypto';
import {
  attributesOf,
  categoriesOf,
  priceRuleOf,
  type AttributeDef,
  type Category,
  type Subcategory,
} from './categories.js';
import type { CountryCode } from './countries.js';
import type { Money } from './money.js';
import { placesOf, type Place } from './places.js';

/** Fixed Keycloak subjects of the demo users (deploy/keycloak/realm-raadi.json). */
export const DEMO_USERS = [
  { id: '3f0c5a6e-1b7d-4c2a-9e51-7a0d2b6c4f11', sellerName: 'Kari N.' },
  { id: '8b2e4d90-5c3a-4f6b-a1d7-2e9c0f3b5a22', sellerName: 'Ola N.' },
  { id: 'c7d1f2a4-9e6b-4a3c-8f50-1b4e7d2a6c33', sellerName: 'Amina H.' },
] as const;

export const DEMO_LISTING_COUNT = 500;

/**
 * Listings owned by each demo user. Kept well under the OPA quota of 50 active
 * listings (deploy/opa/policies/raadi/listings.rego), so the demo users can
 * still create listings. The rest belong to seed-only sellers without a login.
 */
export const DEMO_LISTINGS_PER_USER = 12;

const SELLER_NAMES = [
  'Ingrid',
  'Lars',
  'Fatima',
  'Magnus',
  'Sigrid',
  'Ahmed',
  'Nora',
  'Henrik',
  'Leila',
  'Erik',
  'Hanna',
  'Jonas',
  'Maryam',
  'Sander',
  'Thea',
  'Omar',
  'Silje',
  'Kristian',
  'Hodan',
  'Martin',
  'Ida',
  'Emil',
  'Zainab',
  'Tobias',
  'Marte',
  'Yusuf',
  'Ragnhild',
  'Anders',
  'Sara',
  'Petter',
  'Eva',
  'Mohamed',
  'Live',
  'Sindre',
  'Ayaan',
  'Kristine',
  'Øystein',
  'Astrid',
  'Ali',
  'Vilde',
];

/** Seed-only sellers: listings and images only, no Keycloak account. */
export const DEMO_SELLERS = SELLER_NAMES.map((name, n) => ({
  id: demoUuid(`seller-${n}`),
  sellerName: `${name} ${String.fromCharCode(65 + ((n * 7) % 26))}.`,
}));

/** RFC 4122 version-5 (name-based, SHA-1) UUID in the Raadi demo namespace. */
export function demoUuid(name: string): string {
  const ns = Buffer.from('6d9a2c1e4b7f4e0a9c3d5b8e1f2a7c64', 'hex');
  const hash = createHash('sha1').update(ns).update(name).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** mulberry32: tiny, fast, good enough for demo data. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof prng>;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const between = (rng: Rng, min: number, max: number, step = 1) =>
  Math.round((min + rng() * (max - min)) / step) * step;

interface Template {
  titles: readonly string[];
  blurb: string;
  price: [number, number, number];
}

const T = (titles: string[], blurb: string, price: [number, number, number]): Template => ({
  titles,
  blurb,
  price,
});

const TEMPLATES: Record<Subcategory, Template> = {
  elektronikk: T(
    [
      'iPhone 15 128 GB',
      'Samsung Galaxy S24',
      'MacBook Air M3',
      'PlayStation 5 med to kontrollere',
      'Sony WH-1000XM5 hodetelefoner',
      'LG OLED 55" TV',
      'iPad 10. generasjon',
      'Nintendo Switch OLED',
    ],
    'Lite brukt og i god stand. Original eske og lader følger med.',
    [500, 15000, 50],
  ),
  mobler: T(
    [
      'Sofa i grått stoff',
      'Spisebord i eik med seks stoler',
      'IKEA Billy bokhylle',
      'Lenestol i skinn',
      'Skrivebord med skuffer',
      'Kommode i hvitt',
      'Sengeramme 160 cm',
    ],
    'Røykfritt hjem uten dyr. Må hentes.',
    [200, 12000, 50],
  ),
  klaer: T(
    [
      'Vinterjakke fra Norrøna',
      'Bunad, Østfold',
      'Joggesko str. 42',
      'Ullgenser, strikket',
      'Regnsett til barn',
      'Dress str. 50',
    ],
    'Brukt noen få ganger. Kan sendes mot porto.',
    [100, 6000, 50],
  ),
  sport: T(
    [
      'Langrennsski med bindinger',
      'Terrengsykkel 29"',
      'Telt for to personer',
      'Slalåmski 170 cm',
      'Kajakk med åre',
      'Treningsbenk og vekter',
    ],
    'Godt vedlikeholdt. Prøvetur avtales.',
    [300, 20000, 100],
  ),
  barn: T(
    [
      'Barnevogn, komplett',
      'Bilstol 0–13 kg',
      'Lekekjøkken i tre',
      'Barneseng med madrass',
      'Sparkesykkel',
      'LEGO Duplo-kasse',
    ],
    'Fra røykfritt hjem. Rengjort og klar til bruk.',
    [100, 5000, 50],
  ),
  hobby: T(
    [
      'Akustisk gitar',
      'Symaskin fra Husqvarna',
      'Frimerkesamling',
      'Digitalpiano med benk',
      'Speilreflekskamera med objektiv',
      'Modelljernbane',
    ],
    'Selges grunnet flytting. Spør gjerne om flere bilder.',
    [200, 10000, 50],
  ),
  hage: T(
    [
      'Gressklipper, selvgående',
      'Hagemøbelsett i teak',
      'Drill og slagtrekker fra Makita',
      'Terrassevarmer',
      'Varmepumpe, nesten ny',
      'Høytrykksspyler',
    ],
    'Fungerer som den skal. Kan vises etter avtale.',
    [200, 15000, 50],
  ),
  antikviteter: T(
    [
      'Gammel kiste med rosemaling',
      'Maleri, olje på lerret',
      'Porsjonsfat fra Porsgrund',
      'Bestefars lommeur',
      'Kobberkjele fra 1800-tallet',
    ],
    'Pent bevart. Se bildene for detaljer.',
    [300, 25000, 100],
  ),
  dyr: T(
    [
      'Hundebur, stort',
      'Akvarium 200 liter med utstyr',
      'Kattetre i tre etasjer',
      'Hestedekken str. 145',
      'Kaninbur med løpegård',
    ],
    'Rengjort og klar for nytt hjem. Selges uten dyr.',
    [100, 6000, 50],
  ),
  kjoretoyutstyr: T(
    [
      'Vinterhjul 17" på felg',
      'Takboks fra Thule',
      'Sykkelstativ til hengerfeste',
      'MC-hjelm str. M',
      'Påhengsmotor 5 hk',
    ],
    'Lite brukt. Passer de fleste modeller.',
    [300, 15000, 100],
  ),
  personbil: T(
    [
      'Volkswagen Golf 1.5 TSI',
      'Toyota Corolla Hybrid',
      'Volvo V60 D4',
      'Skoda Octavia stasjonsvogn',
      'BMW 320d Touring',
    ],
    'Service fulgt. EU-godkjent. Vinterhjul på felg følger med.',
    [60000, 450000, 1000],
  ),
  varebil: T(
    ['Volkswagen Transporter', 'Ford Transit Custom', 'Toyota Proace', 'Mercedes Vito'],
    'Godt egnet for håndverkere. Hengerfeste og innredning.',
    [80000, 380000, 1000],
  ),
  motorsykkel: T(
    ['Yamaha MT-07', 'Honda CB500X', 'BMW R 1250 GS', 'Kawasaki Z650'],
    'Garasjeoppbevart. Nytt dekk bak.',
    [40000, 220000, 1000],
  ),
  bobil: T(
    ['Hymer B-klasse', 'Adria Matrix', 'Bürstner Lyseo', 'Knaus Sky Wave'],
    'Klar for sommeren. Markise og solcellepanel.',
    [350000, 900000, 5000],
  ),
  salg: T(
    [
      'Lys 3-roms med balkong',
      'Rekkehus med hage',
      'Enebolig med utsikt',
      'Moderne 2-roms i sentrum',
    ],
    'Visning etter avtale. Kort vei til skole, butikk og kollektivtransport.',
    [2500000, 9500000, 10000],
  ),
  utleie: T(
    [
      'Hybel nær universitetet',
      '2-roms til leie',
      'Møblert leilighet, korttid',
      'Stor 4-roms til leie',
    ],
    'Depositum tre måneders leie. Ledig fra neste måned.',
    [7000, 25000, 500],
  ),
  fritid: T(
    [
      'Hytte ved vannet',
      'Fjellhytte med anneks',
      'Sjøhytte med båtplass',
      'Fritidsleilighet i skianlegg',
    ],
    'Strøm og innlagt vann. Bilvei helt frem.',
    [900000, 4500000, 10000],
  ),
  tomt: T(
    ['Regulert boligtomt', 'Hyttetomt med utsikt', 'Næringstomt nær E6'],
    'Ferdig regulert. Vann og avløp i nærheten.',
    [400000, 2500000, 10000],
  ),
  nybygg: T(
    ['Nye leiligheter i byggetrinn 2', 'Nye rekkehus ved skogen', 'Prosjekt: moderne eneboliger'],
    'Innflytting neste år. Velg kjøkken og fliser selv.',
    [3500000, 9000000, 10000],
  ),
  naering: T(
    ['Kontorlokale i sentrum', 'Lagerhall med kontor', 'Butikklokale på gateplan'],
    'Fleksibel planløsning. Parkering i kjeller.',
    [1500000, 20000000, 10000],
  ),
  it: T(
    ['Fullstack-utvikler', 'Plattformingeniør (DevOps)', 'IT-konsulent', 'Dataingeniør'],
    'Vi søker en engasjert kollega til et voksende team. Fleksibel arbeidstid og hjemmekontor.',
    [0, 0, 1],
  ),
  helse: T(
    ['Sykepleier, sommervikar', 'Helsefagarbeider', 'Fysioterapeut', 'Tannhelsesekretær'],
    'Godt arbeidsmiljø og faglig utvikling. Turnus etter avtale.',
    [0, 0, 1],
  ),
  bygg: T(
    ['Tømrer', 'Elektriker', 'Prosjektleder bygg', 'Rørlegger'],
    'Faste oppdrag i regionen. Firmabil disponeres.',
    [0, 0, 1],
  ),
  undervisning: T(
    ['Lærer 1.–7. trinn', 'Barnehagelærer', 'Lektor i matematikk'],
    'Spennende stilling i et inkluderende miljø.',
    [0, 0, 1],
  ),
  handel: T(
    ['Butikkmedarbeider', 'Butikksjef', 'Lagermedarbeider'],
    'Serviceinnstilt og løsningsorientert? Søk i dag.',
    [0, 0, 1],
  ),
  transport: T(
    ['Sjåfør klasse C', 'Bussjåfør', 'Budbilsjåfør'],
    'Gode betingelser og moderne bilpark.',
    [0, 0, 1],
  ),
  kontor: T(
    ['Regnskapsmedarbeider', 'Kundekonsulent', 'HR-rådgiver', 'Resepsjonist'],
    'Hyggelige kolleger og gode utviklingsmuligheter.',
    [0, 0, 1],
  ),
  industri: T(
    ['Industrimekaniker', 'Prosessoperatør', 'Sveiser'],
    'Skiftarbeid med gode tillegg. Fagbrev er en fordel.',
    [0, 0, 1],
  ),
  reiseliv: T(
    ['Kokk', 'Servitør', 'Hotellresepsjonist'],
    'Travel og trivelig arbeidsplass i sesongen.',
    [0, 0, 1],
  ),
  hytteutleie: T(
    ['Koselig hytte i fjellet', 'Hytte ved sjøen, ledig i sommer', 'Tømmerhytte med badstue'],
    'Sengetøy kan leies. Pris per natt.',
    [800, 4000, 100],
  ),
  leilighet: T(
    ['Leilighet i sentrum, korttidsleie', 'Ferieleilighet med havutsikt', 'Studio nær stasjonen'],
    'Rent og ryddig. Pris per natt.',
    [600, 2500, 100],
  ),
  pakkereise: T(
    ['Uke på Gran Canaria', 'Storbyhelg i Roma', 'Fotturer i Alpene'],
    'Fly og hotell inkludert. Pris per person.',
    [4000, 20000, 500],
  ),
};

const SUBCATEGORIES: Record<Category, readonly Subcategory[]> = Object.fromEntries(
  categoriesOf('NO').map((c) => [c.id, (c.children ?? []).map((s) => s.id)]),
);

const CATEGORY_WEIGHTS: Array<[Category, number]> = [
  ['torget', 0.45],
  ['bil', 0.2],
  ['eiendom', 0.12],
  ['jobb', 0.13],
  ['reise', 0.1],
];

const EMPLOYERS = [
  'Nordlys AS',
  'Fjordteknikk',
  'Helse Vest',
  'Byggmester Berg',
  'Kommunen',
  'Handelshuset',
];

export interface DemoImage {
  id: string;
  /** Hue (0–359) for the generated illustration. */
  hue: number;
  category: Category;
  label: string;
}

export interface DemoListing {
  id: string;
  ownerId: string;
  sellerName: string;
  country: CountryCode;
  category: Category;
  subcategory: Subcategory;
  title: string;
  description: string;
  price: Money | null;
  attributes: Record<string, string | number>;
  place: Place;
  images: DemoImage[];
  /** Days before "now" the listing was published (0–60). */
  ageDays: number;
}

function attributesFor(
  rng: Rng,
  category: Category,
  sub: Subcategory,
  title: string,
): Record<string, string | number> {
  switch (category) {
    case 'torget':
      return { condition: pick(rng, ['new', 'like_new', 'good', 'fair'] as const) };
    case 'bil': {
      const [make = 'Volvo', ...model] = title.split(' ');
      return {
        make,
        model: model.join(' ') || 'Ukjent',
        year: between(rng, 2008, 2025),
        mileageKm: between(rng, 5000, 250000, 1000),
        fuel:
          sub === 'motorsykkel'
            ? 'petrol'
            : pick(rng, ['petrol', 'diesel', 'electric', 'hybrid'] as const),
        gearbox: pick(rng, ['manual', 'automatic'] as const),
        ...(sub === 'personbil'
          ? {
              bodyType: pick(rng, ['sedan', 'station_wagon', 'hatchback', 'suv'] as const),
              drivetrain: pick(rng, ['fwd', 'fwd', 'rwd', 'awd'] as const),
            }
          : {}),
      };
    }
    case 'eiendom':
      return {
        propertyType:
          sub === 'tomt'
            ? 'plot'
            : sub === 'fritid'
              ? 'cabin'
              : sub === 'naering'
                ? 'commercial'
                : pick(rng, ['apartment', 'house', 'townhouse'] as const),
        areaM2:
          sub === 'tomt' || sub === 'naering' ? between(rng, 80, 2000, 10) : between(rng, 25, 220),
        ...(sub === 'tomt' || sub === 'naering' ? {} : { bedrooms: between(rng, 0, 5) }),
        ...(sub === 'salg' || sub === 'nybygg'
          ? { ownership: pick(rng, ['freehold', 'freehold', 'cooperative', 'shares'] as const) }
          : {}),
      };
    case 'jobb':
      return {
        employer: pick(rng, EMPLOYERS),
        employmentType: pick(rng, [
          'full_time',
          'full_time',
          'part_time',
          'temporary',
          'internship',
        ] as const),
      };
    case 'reise':
      return { guests: between(rng, 2, 8) };
    default:
      return {};
  }
}

function imageCount(rng: Rng, category: Category): number {
  if (category === 'jobb') return 1;
  if (category === 'bil' || category === 'eiendom') return between(rng, 2, 3);
  return between(rng, 1, 3);
}

/** The full demo dataset, Norway's and Somaliland's, generated identically on every call. */
export function demoListings(): DemoListing[] {
  return [...demoListingsNorway(), ...demoListingsSomaliland()];
}

/** Norway's demo listings (test country): unchanged since Phase 2, so ids and tests stay stable. */
export function demoListingsNorway(count = DEMO_LISTING_COUNT): DemoListing[] {
  const rng = prng(20261001);
  const places = placesOf('NO');
  const listings: DemoListing[] = [];
  for (let i = 0; i < count; i++) {
    let roll = rng();
    const category = CATEGORY_WEIGHTS.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'torget';
    const subcategory = pick(rng, SUBCATEGORIES[category]!);
    const template = TEMPLATES[subcategory]!;
    const title = pick(rng, template.titles);
    const owner =
      i < DEMO_USERS.length * DEMO_LISTINGS_PER_USER
        ? DEMO_USERS[i % DEMO_USERS.length]!
        : DEMO_SELLERS[i % DEMO_SELLERS.length]!;
    const place = pick(rng, places);
    const [min, max, step] = template.price;
    const id = demoUuid(`listing-${i}`);
    const hue = Math.floor(rng() * 360);
    listings.push({
      id,
      ownerId: owner.id,
      sellerName: owner.sellerName,
      category,
      subcategory,
      title,
      country: 'NO',
      description: `${title}. ${template.blurb} Henting i ${place.name}.`,
      price:
        category === 'jobb'
          ? null
          : { amountMinor: between(rng, min, max, step) * 100, currency: 'NOK' },
      attributes: attributesFor(rng, category, subcategory, title),
      place,
      images: Array.from({ length: imageCount(rng, category) }, (_, j) => ({
        id: demoUuid(`listing-${i}-image-${j}`),
        hue: (hue + j * 40) % 360,
        category,
        label: title,
      })),
      ageDays: Math.floor(rng() * 60),
    });
  }
  return listings;
}

/* ── Somaliland (first market, ADR-0033) ─────────────────────────────────────────────────────── */

export const DEMO_XS_LISTING_COUNT = 300;

const XS_SELLER_NAMES = [
  'Abdirahman',
  'Hodan',
  'Mukhtar',
  'Sahra',
  'Abdi',
  'Nimco',
  'Khadar',
  'Ayaan',
  'Guleed',
  'Hibo',
  'Liban',
  'Ifrah',
  'Mahad',
  'Fardowsa',
  'Yasin',
  'Deeqa',
  'Jama',
  'Ubah',
  'Warsame',
  'Shukri',
];

/** Seed-only sellers in Somaliland (no Keycloak account): 15 listings each, well under the quota. */
export const DEMO_XS_SELLERS = XS_SELLER_NAMES.map((name, n) => ({
  id: demoUuid(`xs-seller-${n}`),
  sellerName: `${name} ${String.fromCharCode(65 + ((n * 5) % 26))}.`,
}));

/** Titles (English, some Somali) and a price range in US dollars: [min, max, step]. */
const XS_TEMPLATES: Record<
  Subcategory,
  { titles: readonly string[]; price: [number, number, number] }
> = {
  cars: {
    titles: [
      'Toyota Land Cruiser V8',
      'Toyota Vitz',
      'Toyota Mark X',
      'Nissan Patrol',
      'Toyota Hilux Surf',
      'Suzuki Swift',
      'Toyota Noah',
      'Mitsubishi Pajero',
    ],
    price: [3000, 45000, 100],
  },
  motorcycles: {
    titles: ['Bajaj Boxer 150', 'TVS King tuk-tuk', 'Honda CG 125', 'Bajaj RE three-wheeler'],
    price: [600, 4500, 50],
  },
  'trucks-buses': {
    titles: ['Isuzu NPR truck', 'Toyota Coaster bus', 'Mitsubishi Canter', 'Isuzu water tanker'],
    price: [8000, 60000, 500],
  },
  'auto-parts': {
    titles: [
      'Tyres 265/65 R17, set of 4',
      'Car battery 100Ah',
      'Land Cruiser front bumper',
      'Engine oil 5 L',
      'Shock absorbers, pair',
    ],
    price: [10, 900, 5],
  },
  'houses-rent': {
    titles: [
      '3-bedroom house with compound',
      'Modern apartment near the centre',
      'Guri kiro ah, 2 qol',
      'Furnished villa with garden',
      'Room for rent, shared kitchen',
    ],
    price: [100, 1200, 10],
  },
  'houses-sale': {
    titles: [
      'Villa with garden',
      'Guri iib ah, 4 qol',
      'Family house with water tank',
      'New apartment, 3 bedrooms',
    ],
    price: [15000, 250000, 1000],
  },
  land: {
    titles: [
      'Residential plot 20×20 m',
      'Dhul iib ah',
      'Farm land with a well',
      'Commercial plot on the main road',
    ],
    price: [2000, 80000, 500],
  },
  'commercial-property': {
    titles: ['Shop on the main road', 'Warehouse near the port', 'Office space, 2nd floor'],
    price: [200, 50000, 50],
  },
  'short-stays': {
    titles: ['Guest house room', 'Furnished apartment for short stays', 'Holiday house by the sea'],
    price: [20, 150, 5],
  },
  'mobile-phones': {
    titles: [
      'iPhone 13 128 GB',
      'Samsung Galaxy A54',
      'Tecno Spark 20',
      'Infinix Hot 40',
      'iPhone 15 Pro Max',
      'Xiaomi Redmi Note 13',
      'Taleefan Samsung A15',
    ],
    price: [60, 1300, 5],
  },
  tablets: {
    titles: ['iPad 9th generation', 'Samsung Galaxy Tab A8', 'Huawei MatePad'],
    price: [80, 500, 5],
  },
  'phone-accessories': {
    titles: [
      'Power bank 20000 mAh',
      'Wireless earbuds',
      'Phone cases, wholesale',
      'Fast charger 25 W',
    ],
    price: [3, 150, 1],
  },
  computers: {
    titles: [
      'HP EliteBook 840',
      'Dell Latitude 5420',
      'MacBook Air M1',
      'HP LaserJet printer',
      '24" monitor',
    ],
    price: [80, 1100, 10],
  },
  'solar-power': {
    titles: [
      'Solar panel 300 W',
      'Lithium battery 200 Ah',
      'Inverter 3 kW',
      'Complete solar kit for a house',
      'Solar street light',
    ],
    price: [25, 2500, 5],
  },
  appliances: {
    titles: [
      'Fridge 300 L',
      'Split air conditioner 1.5 ton',
      'Washing machine',
      'Water dispenser',
      'Gas cooker with oven',
    ],
    price: [40, 900, 5],
  },
  'tv-audio': {
    titles: ['Smart TV 55"', 'Sound bar with subwoofer', 'Satellite receiver', 'Bluetooth speaker'],
    price: [15, 700, 5],
  },
  furniture: {
    titles: [
      'Sofa set, 7 seats',
      'Fadhi casri ah',
      'Bed with mattress',
      'Dining table with 6 chairs',
      'Wardrobe, 3 doors',
    ],
    price: [40, 1500, 10],
  },
  kitchenware: {
    titles: ['Cooking pots, set', 'Thermos flasks', 'Dinner set, 24 pieces', 'Blender'],
    price: [5, 150, 1],
  },
  'home-decor': {
    titles: ['Persian carpet 3×4 m', 'Curtains with rails', 'Wall clock', 'Dabqaad incense burner'],
    price: [5, 400, 5],
  },
  'mens-clothing': {
    titles: ['Macawis, set of 3', 'Suit, size 50', 'Khamiis', 'Leather jacket'],
    price: [5, 200, 1],
  },
  'womens-clothing': {
    titles: ['Dirac, new', 'Garbasaar', 'Abaya', 'Wedding dress'],
    price: [8, 400, 2],
  },
  shoes: { titles: ['Sandals, size 42', 'Sneakers, size 40', 'Leather shoes'], price: [5, 120, 1] },
  'jewellery-watches': {
    titles: ['Gold necklace 21k', 'Casio watch', 'Silver bracelet'],
    price: [15, 3000, 5],
  },
  bags: { titles: ['Leather handbag', 'School backpack', 'Travel suitcase'], price: [5, 150, 1] },
  camels: {
    titles: ['Young camels', 'Geel iib ah', 'Milking camel', 'Camels for Eid'],
    price: [400, 12000, 50],
  },
  'goats-sheep': {
    titles: ['Black-head Somali sheep', 'Ari iyo ido', 'Goats for Eid', 'Somali goats'],
    price: [40, 3000, 10],
  },
  cattle: { titles: ['Dairy cow', "Lo' iib ah", 'Bull'], price: [300, 4000, 50] },
  poultry: { titles: ['Laying hens', 'Digaag', 'Chicks'], price: [5, 600, 5] },
  'farm-produce': {
    titles: ['Fresh tomatoes, per crate', 'Watermelons', 'Dates, 10 kg', 'Malab (pure honey)'],
    price: [3, 200, 1],
  },
  'animal-feed': {
    titles: ['Hay bales', 'Sorghum, 50 kg sack', 'Animal feed pellets'],
    price: [5, 300, 1],
  },
  'farm-equipment': {
    titles: ['Water pump', 'Tractor plough', 'Irrigation pipes'],
    price: [50, 6000, 10],
  },
  'ngo-jobs': {
    titles: ['Project officer', 'Nutrition coordinator', 'Field monitor'],
    price: [0, 0, 1],
  },
  'it-jobs': { titles: ['Web developer', 'Network technician'], price: [0, 0, 1] },
  'sales-jobs': { titles: ['Shop assistant', 'Sales agent, mobile money'], price: [0, 0, 1] },
  'driver-jobs': { titles: ['Driver with licence', 'Truck driver'], price: [0, 0, 1] },
  'teaching-jobs': { titles: ['English teacher', 'Mathematics teacher'], price: [0, 0, 1] },
  'health-jobs': { titles: ['Nurse', 'Pharmacist'], price: [0, 0, 1] },
  'construction-jobs': { titles: ['Mason', 'Electrician'], price: [0, 0, 1] },
  'hospitality-jobs': { titles: ['Hotel receptionist', 'Cook'], price: [0, 0, 1] },
  'office-jobs': { titles: ['Accountant', 'Office assistant'], price: [0, 0, 1] },
  'building-trades': {
    titles: ['Plumber', 'House electrician', 'Tile fixing'],
    price: [5, 300, 5],
  },
  'transport-logistics': {
    titles: ['Moving services', 'Cargo transport to the port'],
    price: [20, 600, 10],
  },
  tutoring: { titles: ['Quran teacher', 'English lessons', 'Maths tutor'], price: [5, 100, 5] },
  'it-services': { titles: ['Website design', 'Computer networking'], price: [50, 800, 10] },
  'events-catering': { titles: ['Wedding catering', 'Event tent hire'], price: [50, 1500, 10] },
  'beauty-services': { titles: ['Henna artist', 'Barber, home visits'], price: [5, 80, 5] },
  'repair-services': { titles: ['Phone repair', 'Fridge and AC repair'], price: [5, 120, 5] },
  'business-equipment': {
    titles: ['Generator 20 kVA', 'Commercial freezer', 'Sewing machines'],
    price: [100, 9000, 10],
  },
  wholesale: {
    titles: ['Rice, 25 kg sacks', 'Sugar, wholesale', 'Cooking oil, 20 L'],
    price: [10, 2000, 5],
  },
  'baby-gear': { titles: ['Baby stroller', 'Child car seat', 'Baby cot'], price: [10, 250, 5] },
  toys: { titles: ['Remote-control car', 'Building blocks', 'Football'], price: [3, 120, 1] },
  'kids-clothing': { titles: ['School uniform', 'Eid clothes for kids'], price: [3, 60, 1] },
  'sports-equipment': { titles: ['Football boots', 'Treadmill', 'Bicycle'], price: [10, 900, 5] },
  books: {
    titles: ['Quran, large print', 'University textbooks', 'Somali novels'],
    price: [2, 80, 1],
  },
  'musical-instruments': { titles: ['Oud', 'Keyboard', 'Guitar'], price: [30, 700, 5] },
};

const XS_WEIGHTS: Array<[Category, number]> = [
  ['vehicles', 0.14],
  ['property', 0.14],
  ['phones', 0.14],
  ['electronics', 0.12],
  ['home', 0.07],
  ['fashion', 0.07],
  ['livestock', 0.1],
  ['agriculture', 0.04],
  ['jobs', 0.07],
  ['services', 0.05],
  ['business', 0.02],
  ['kids', 0.02],
  ['sports-hobbies', 0.02],
];

const XS_BLURBS: Record<Category, string> = {
  vehicles: 'Clean papers, ready to drive. Call or message to view.',
  property: 'Water and electricity connected. Viewing any day.',
  phones: 'Works perfectly, comes with charger.',
  electronics: 'Tested and working. Delivery possible in town.',
  home: 'Good quality, collection only.',
  fashion: 'Good quality, several sizes.',
  livestock: 'Healthy animals, vaccinated. Xoolo caafimaad qaba.',
  agriculture: 'Fresh from the farm.',
  jobs: 'Send your CV through Raadiso messages.',
  services: 'Reliable and experienced. Fair prices.',
  business: 'Serious buyers only.',
  kids: 'Clean and in good condition.',
  'sports-hobbies': 'Barely used.',
};

const XS_EMPLOYERS = [
  'Horumar Trading',
  'Hargeisa Builders',
  'Sahan Relief',
  'Port Logistics',
  'City Clinic',
  'Bright School',
];

const PHONE_BRAND_OF: Array<[RegExp, string]> = [
  [/iphone|ipad/i, 'apple'],
  [/samsung/i, 'samsung'],
  [/tecno/i, 'tecno'],
  [/infinix/i, 'infinix'],
  [/xiaomi|redmi/i, 'xiaomi'],
  [/huawei/i, 'huawei'],
];

/** Item types a title names (a seller picks the type that fits; the demo does the same). */
const ITEM_TYPE_OF: Array<[RegExp, string]> = [
  [/elitebook|latitude|macbook|laptop/i, 'laptop'],
  [/printer/i, 'printer'],
  [/monitor/i, 'monitor'],
  [/panel/i, 'panel'],
  [/battery/i, 'battery'],
  [/inverter/i, 'inverter'],
  [/kit/i, 'kit'],
  [/light/i, 'light'],
  [/fridge/i, 'fridge'],
  [/air conditioner/i, 'air_conditioner'],
  [/washing/i, 'washing_machine'],
  [/dispenser/i, 'water_dispenser'],
  [/cooker/i, 'cooker'],
];

/** Plausible numbers per attribute: [min, max, step]. */
const XS_NUMBERS: Record<string, [number, number, number]> = {
  year: [2004, 2022, 1],
  mileageKm: [20_000, 250_000, 1000],
  bedrooms: [1, 6, 1],
  areaM2: [80, 600, 10],
  guests: [1, 8, 1],
  storageGb: [32, 512, 32],
};
const HEAD: Record<Subcategory, [number, number]> = {
  camels: [1, 12],
  'goats-sheep': [5, 60],
  cattle: [1, 10],
  poultry: [10, 200],
};

/** Attributes generated from the taxonomy's definitions, consistent with the title. */
function xsAttributes(rng: Rng, category: Category, sub: Subcategory, title: string) {
  const out: Record<string, string | number> = {};
  const [first = 'Toyota', ...rest] = title.split(' ');
  for (const def of attributesOf(category, sub) as AttributeDef[]) {
    if (!def.required && rng() < 0.35) continue;
    if (def.key === 'make') out.make = first;
    else if (def.key === 'model') out.model = rest.join(' ') || first;
    else if (def.key === 'employer') out.employer = pick(rng, XS_EMPLOYERS);
    else if (def.key === 'brand')
      out.brand =
        PHONE_BRAND_OF.find(([re]) => re.test(title))?.[1] ??
        pick(rng, def.kind === 'select' ? def.options : ['other']);
    else if (def.key === 'head') out.head = between(rng, ...(HEAD[sub] ?? [1, 10]));
    else if (def.key === 'areaM2' && sub === 'land') out.areaM2 = between(rng, 200, 5000, 50);
    else if (def.kind === 'select') {
      // Drawn either way, so the rest of the dataset stays the same; the title wins where it says.
      const drawn = pick(rng, def.options);
      const named =
        def.key === 'itemType' ? ITEM_TYPE_OF.find(([re]) => re.test(title))?.[1] : undefined;
      out[def.key] = named && def.options.includes(named) ? named : drawn;
    } else if (def.kind === 'number') {
      const [min, max, step] = XS_NUMBERS[def.key] ?? [
        def.min,
        Math.min(def.max, def.min + 100),
        1,
      ];
      out[def.key] = between(rng, min, max, step);
    } else out[def.key] = title.slice(0, def.maxLength);
  }
  return out;
}

/** Somaliland's demo listings: US dollars, Somaliland's towns, English and some Somali. */
export function demoListingsSomaliland(count = DEMO_XS_LISTING_COUNT): DemoListing[] {
  const rng = prng(20261008);
  const places = placesOf('XS');
  // Most people live in and around Hargeisa and Burao: weight the first towns.
  const town = () => places[Math.floor(rng() ** 1.8 * places.length)]!;
  const subs = Object.fromEntries(
    categoriesOf('XS').map((c) => [c.id, (c.children ?? []).map((s) => s.id)]),
  );
  // Every subcategory once first, so each category page has listings in every tile; then by weight.
  const tour = Object.entries(subs).flatMap(([c, ss]) => ss.map((sub) => [c, sub] as const));
  const listings: DemoListing[] = [];
  for (let i = 0; i < count; i++) {
    let roll = rng();
    const weighted = XS_WEIGHTS.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'phones';
    const [category, subcategory] = tour[i] ?? [weighted, pick(rng, subs[weighted]!)];
    const template = XS_TEMPLATES[subcategory]!;
    const title = pick(rng, template.titles);
    const owner = DEMO_XS_SELLERS[i % DEMO_XS_SELLERS.length]!;
    const place = town();
    const [min, max, step] = template.price;
    const rule = priceRuleOf(category, subcategory);
    const priced = rule === 'required' || (rule === 'optional' && rng() < 0.6);
    const id = demoUuid(`xs-listing-${i}`);
    const hue = Math.floor(rng() * 360);
    const images = category === 'jobs' ? 1 : between(rng, 1, 3);
    listings.push({
      id,
      ownerId: owner.id,
      sellerName: owner.sellerName,
      country: 'XS',
      category,
      subcategory,
      title,
      description: `${title}. ${XS_BLURBS[category]} Located in ${place.name}.`,
      price: priced ? { amountMinor: between(rng, min, max, step) * 100, currency: 'USD' } : null,
      attributes: xsAttributes(rng, category, subcategory, title),
      place,
      images: Array.from({ length: images }, (_, j) => ({
        id: demoUuid(`xs-listing-${i}-image-${j}`),
        hue: (hue + j * 40) % 360,
        category,
        label: title,
      })),
      ageDays: Math.floor(rng() * 60),
    });
  }
  return listings;
}
