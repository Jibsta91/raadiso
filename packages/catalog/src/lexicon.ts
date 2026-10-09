import type { Locale } from './countries.js';

/*
 * The words people type for categories and attribute values, per language (ADR-0041). Search uses them to
 * understand a query ("cheap toyota hargeisa") and to boost what a word names. Lower case; matching folds
 * accents and Norwegian letters on both sides. Plurals and common spellings are listed: there is no
 * stemming here. Zod-free. Somali words need a native speaker's review before launch (ADR-0040).
 */

export type Words = Partial<Record<Locale, readonly string[]>>;

/** Words for each category and subcategory id (a subcategory implies its category). */
export const NODE_WORDS: Readonly<Record<string, Words>> = {
  // ── Somaliland ──────────────────────────────────────────────────────────────────────────────
  vehicles: { en: ['vehicle', 'vehicles'], so: ['gaadiid', 'gaadiidka'] },
  cars: {
    en: ['car', 'cars', 'automobile', 'suv', '4x4', 'pickup'],
    so: ['baabuur', 'baabuurta', 'gaari', 'gaadhi', 'gawaari'],
  },
  motorcycles: {
    en: ['motorcycle', 'motorcycles', 'motorbike', 'tuk-tuk', 'tuktuk', 'bajaj', 'scooter'],
    so: ['mooto', 'mootooyin', 'bajaaj'],
  },
  'trucks-buses': {
    en: ['truck', 'trucks', 'lorry', 'bus', 'buses', 'minibus', 'water tanker'],
    so: ['xamuul', 'bas', 'baska', 'basas'],
  },
  'auto-parts': {
    en: [
      'spare parts',
      'car parts',
      'parts',
      'tyre',
      'tyres',
      'tire',
      'tires',
      'car battery',
      'bumper',
    ],
    so: ['spare', 'taayir', 'taayirro', 'shaag'],
  },
  property: { en: ['property', 'real estate'], so: ['hanti ma guurto'] },
  'houses-rent': {
    en: [
      'for rent',
      'to rent',
      'rent',
      'rental',
      'house for rent',
      'apartment for rent',
      'room for rent',
    ],
    so: ['kiro', 'kirada', 'guri kiro', 'guri kiro ah'],
  },
  'houses-sale': {
    en: [
      'house',
      'houses',
      'home',
      'homes',
      'villa',
      'apartment',
      'apartments',
      'flat',
      'house for sale',
    ],
    so: ['guri', 'guryo', 'aqal', 'fiilo', 'guri iib ah'],
  },
  land: { en: ['land', 'plot', 'plots'], so: ['dhul', 'boos', 'dhul iib ah'] },
  'commercial-property': {
    en: ['shop for rent', 'office space', 'office', 'offices', 'warehouse', 'warehouses'],
    so: ['dukaan', 'dukaamo', 'xafiis', 'bakhaar'],
  },
  'short-stays': {
    en: ['short stay', 'short stays', 'guest house', 'guesthouse', 'holiday house'],
    so: ['martigelin'],
  },
  phones: { en: ['phones and tablets'], so: ['taleefanno'] },
  'mobile-phones': {
    en: [
      'phone',
      'phones',
      'mobile',
      'mobiles',
      'mobile phone',
      'smartphone',
      'smartphones',
      'cellphone',
    ],
    so: ['taleefan', 'taleefanka', 'mobaayil', 'telefoon'],
  },
  tablets: { en: ['tablet', 'tablets', 'ipad', 'ipads'], so: ['tablet'] },
  'phone-accessories': {
    en: ['charger', 'chargers', 'power bank', 'earbuds', 'headphones', 'phone case', 'phone cases'],
    so: ['shaaje'],
  },
  electronics: { en: ['electronics'], so: ['elektaroonig'] },
  computers: {
    en: ['computer', 'computers', 'pc', 'desktop', 'desktops'],
    so: ['kombiyuutar', 'kombiyuutarro'],
  },
  'solar-power': {
    en: ['solar', 'solar power', 'solar kit', 'solar system'],
    so: ['qorrax', 'tamarta qorraxda'],
  },
  appliances: {
    en: ['appliance', 'appliances', 'freezer', 'cooker', 'stove', 'water dispenser'],
    so: ['shoolad'],
  },
  'tv-audio': {
    en: ['tv', 'tvs', 'television', 'speaker', 'speakers', 'sound bar', 'soundbar', 'receiver'],
    so: ['telefishan', 'sameecad'],
  },
  home: { en: ['household'], so: ['guriga'] },
  furniture: {
    en: [
      'furniture',
      'sofa',
      'sofas',
      'couch',
      'bed',
      'beds',
      'table',
      'chair',
      'chairs',
      'wardrobe',
      'mattress',
    ],
    so: ['fadhi', 'sariir', 'miis', 'kursi', 'kuraas', 'armaajo', 'joodari'],
  },
  kitchenware: {
    en: ['kitchenware', 'kitchen', 'pots', 'pans', 'plates', 'thermos', 'blender'],
    so: ['dheri', 'weel', 'tarmuus'],
  },
  'home-decor': {
    en: ['carpet', 'carpets', 'rug', 'rugs', 'curtains', 'decor', 'clock'],
    so: ['roog', 'daah', 'dabqaad'],
  },
  fashion: { en: ['fashion', 'clothes', 'clothing'], so: ['dhar', 'dharka'] },
  'mens-clothing': {
    en: ["men's clothing", 'shirt', 'shirts', 'suit', 'suits', 'trousers'],
    so: ['macawis', 'khamiis', 'shaati', 'surwaal'],
  },
  'womens-clothing': {
    en: ["women's clothing", 'dress', 'dresses', 'abaya', 'abayas', 'hijab'],
    so: ['dirac', 'garbasaar', 'cabaayad', 'xijaab', 'toob'],
  },
  shoes: {
    en: ['shoes', 'shoe', 'sandals', 'sneakers', 'boots'],
    so: ['kabo', 'kab', 'dacas'],
  },
  'jewellery-watches': {
    en: ['jewellery', 'jewelry', 'gold', 'necklace', 'ring', 'watch', 'watches', 'bracelet'],
    so: ['dahab', 'silsilad', 'fargal', 'saacad'],
  },
  bags: { en: ['bag', 'bags', 'handbag', 'backpack', 'suitcase'], so: ['boorso', 'shandad'] },
  livestock: { en: ['livestock', 'animals'], so: ['xoolo', 'xoolaha'] },
  camels: { en: ['camel', 'camels'], so: ['geel', 'awr', 'hal', 'qaalin'] },
  'goats-sheep': {
    en: ['goat', 'goats', 'sheep', 'lamb', 'lambs'],
    so: ['ari', 'ido', 'riyo', 'wan', 'neef'],
  },
  cattle: {
    en: ['cow', 'cows', 'cattle', 'bull', 'calf'],
    so: ["lo'", 'lo', 'sac', 'dibi', 'weyl'],
  },
  poultry: { en: ['chicken', 'chickens', 'hens', 'poultry', 'eggs'], so: ['digaag', 'ukun'] },
  agriculture: { en: ['agriculture', 'farming'], so: ['beeraha'] },
  'farm-produce': {
    en: ['vegetables', 'fruit', 'tomatoes', 'dates', 'honey', 'watermelon', 'watermelons'],
    so: ['khudaar', 'miro', 'timir', 'malab', 'yaanyo', 'qaraha'],
  },
  'animal-feed': {
    en: ['animal feed', 'feed', 'fodder', 'hay', 'sorghum'],
    so: ['calaf', 'caws', 'haruur'],
  },
  'farm-equipment': {
    en: ['tractor', 'tractors', 'water pump', 'irrigation'],
    so: ['cagaf'],
  },
  jobs: {
    en: ['job', 'jobs', 'vacancy', 'vacancies', 'hiring'],
    so: ['shaqo', 'shaqooyin', 'fursad shaqo'],
  },
  'ngo-jobs': { en: ['ngo', 'ngo jobs', 'humanitarian'], so: ["hay'ad", "hay'adaha"] },
  'it-jobs': { en: ['developer', 'programmer', 'it job', 'network technician'], so: [] },
  'sales-jobs': { en: ['sales job', 'shop assistant', 'cashier', 'sales agent'], so: ['iibiye'] },
  'driver-jobs': { en: ['driver', 'drivers', 'driving job'], so: ['darawal', 'wade'] },
  'teaching-jobs': { en: ['teacher', 'teaching job'], so: ['macallin', 'macalin'] },
  'health-jobs': { en: ['nurse', 'doctor', 'pharmacist'], so: ['kalkaaliye', 'dhakhtar'] },
  'construction-jobs': { en: ['mason', 'construction job'], so: ['wastaad'] },
  'hospitality-jobs': { en: ['cook', 'chef', 'receptionist', 'waiter'], so: ['kariye'] },
  'office-jobs': { en: ['accountant', 'secretary', 'office job'], so: ['xisaabiye'] },
  services: { en: ['service', 'services'], so: ['adeeg', 'adeegyo'] },
  'building-trades': {
    en: ['plumber', 'electrician', 'tiler', 'painter', 'carpenter'],
    so: ['tuubiste', 'najaar'],
  },
  'transport-logistics': {
    en: ['moving', 'movers', 'cargo', 'delivery', 'transport'],
    so: ['rarid'],
  },
  tutoring: {
    en: ['tutor', 'tutoring', 'lessons', 'classes', 'quran teacher'],
    so: ['cashar', 'casharro'],
  },
  'it-services': { en: ['website', 'web design', 'it support', 'networking'], so: [] },
  'events-catering': {
    en: ['catering', 'wedding', 'tent hire', 'events'],
    so: ['aroos', 'xaflad'],
  },
  'beauty-services': { en: ['henna', 'barber', 'salon', 'makeup'], so: ['xinne'] },
  'repair-services': {
    en: ['repair', 'repairs', 'phone repair', 'fridge repair'],
    so: ['dayactir', 'hagaajin'],
  },
  business: { en: ['business equipment', 'industrial'], so: ['ganacsi'] },
  'business-equipment': {
    en: ['generator', 'generators', 'machine', 'machinery', 'sewing machine'],
    so: ['mashiin'],
  },
  wholesale: {
    en: ['wholesale', 'bulk', 'rice', 'sugar', 'cooking oil'],
    so: ['jumlad', 'bariis', 'sonkor', 'saliid'],
  },
  kids: { en: ['kids', 'children', 'baby'], so: ['carruur', 'ilmo'] },
  'baby-gear': { en: ['stroller', 'pram', 'car seat', 'baby cot', 'cot'], so: [] },
  toys: { en: ['toy', 'toys', 'lego'], so: ['alaab ciyaar'] },
  'kids-clothing': { en: ['school uniform', 'kids clothes'], so: ['yuuniform'] },
  'sports-hobbies': { en: ['sports', 'hobby', 'hobbies'], so: ['isboorti'] },
  'sports-equipment': {
    en: ['football boots', 'treadmill', 'bicycle', 'bicycles', 'bike', 'gym'],
    so: ['baaskiil', 'kubad'],
  },
  books: {
    en: ['book', 'books', 'quran', 'textbook', 'textbooks', 'novel', 'novels'],
    so: ['buug', 'buugaag', 'quraan', 'kitaab'],
  },
  'musical-instruments': {
    en: ['guitar', 'oud', 'keyboard', 'piano', 'instrument', 'instruments'],
    so: ['kaban', 'muusik'],
  },

  // ── Norway ──────────────────────────────────────────────────────────────────────────────────
  torget: { nb: ['torget'], en: ['marketplace'] },
  elektronikk: {
    nb: [
      'elektronikk',
      'tv',
      'mobil',
      'mobiltelefon',
      'telefon',
      'pc',
      'laptop',
      'bærbar',
      'hodetelefoner',
      'playstation',
      'nintendo',
      'ipad',
    ],
    en: ['electronics', 'phone', 'phones', 'laptop', 'headphones'],
  },
  mobler: {
    nb: [
      'møbler',
      'sofa',
      'stol',
      'stoler',
      'bord',
      'spisebord',
      'seng',
      'sengeramme',
      'bokhylle',
      'kommode',
      'skrivebord',
      'lenestol',
    ],
    en: ['furniture', 'sofa', 'chair', 'table', 'bed'],
  },
  klaer: {
    nb: ['klær', 'jakke', 'jakker', 'sko', 'genser', 'dress', 'bunad', 'joggesko'],
    en: ['clothes', 'jacket', 'shoes'],
  },
  sport: {
    nb: [
      'sport',
      'ski',
      'langrennsski',
      'slalåmski',
      'sykkel',
      'sykler',
      'telt',
      'kajakk',
      'trening',
    ],
    en: ['sports', 'bike', 'bicycle', 'tent', 'kayak'],
  },
  barn: {
    nb: ['barn', 'barnevogn', 'bilstol', 'barneseng', 'leker', 'lego', 'sparkesykkel'],
    en: ['kids', 'stroller', 'pram', 'toys'],
  },
  hobby: {
    nb: [
      'hobby',
      'gitar',
      'symaskin',
      'piano',
      'digitalpiano',
      'kamera',
      'frimerker',
      'modelljernbane',
    ],
    en: ['guitar', 'camera', 'piano'],
  },
  hage: {
    nb: ['hage', 'gressklipper', 'verktøy', 'drill', 'varmepumpe', 'høytrykksspyler', 'hagemøbler'],
    en: ['garden', 'lawn mower', 'tools'],
  },
  antikviteter: {
    nb: ['antikviteter', 'antikk', 'maleri', 'kunst'],
    en: ['antiques', 'art', 'painting'],
  },
  dyr: { nb: ['dyr', 'hund', 'katt', 'akvarium', 'hest', 'kanin'], en: ['pets', 'dog', 'cat'] },
  kjoretoyutstyr: {
    nb: [
      'vinterhjul',
      'sommerhjul',
      'dekk',
      'felg',
      'felger',
      'takboks',
      'sykkelstativ',
      'hjelm',
      'påhengsmotor',
    ],
    en: ['tyres', 'tires', 'roof box'],
  },
  bil: { nb: ['kjøretøy'], en: ['vehicles'] },
  personbil: {
    nb: ['bil', 'biler', 'personbil', 'personbiler', 'stasjonsvogn', 'elbil', 'elbiler'],
    en: ['car', 'cars'],
  },
  varebil: { nb: ['varebil', 'varebiler', 'kassebil'], en: ['van', 'vans'] },
  motorsykkel: { nb: ['motorsykkel', 'motorsykler', 'mc'], en: ['motorcycle', 'motorbike'] },
  bobil: { nb: ['bobil', 'bobiler', 'campingbil'], en: ['motorhome', 'camper'] },
  eiendom: { nb: ['eiendom', 'bolig', 'boliger'], en: ['property', 'real estate'] },
  salg: {
    nb: ['bolig til salgs', 'leilighet', 'leiligheter', 'enebolig', 'rekkehus', 'hus'],
    en: ['house', 'apartment', 'flat', 'home for sale'],
  },
  utleie: {
    nb: ['til leie', 'leie', 'utleie', 'hybel', 'leilighet til leie', 'bolig til leie'],
    en: ['for rent', 'rent', 'rental'],
  },
  fritid: { nb: ['hytte', 'hytter', 'fritidsbolig', 'fjellhytte'], en: ['cabin', 'holiday home'] },
  tomt: { nb: ['tomt', 'tomter', 'boligtomt', 'hyttetomt'], en: ['plot', 'land'] },
  nybygg: { nb: ['nybygg', 'nye boliger'], en: ['new build', 'new homes'] },
  naering: {
    nb: ['næring', 'næringslokale', 'kontorlokale', 'lagerhall', 'butikklokale'],
    en: ['office space', 'commercial property', 'warehouse'],
  },
  jobb: {
    nb: ['jobb', 'jobber', 'stilling', 'stillinger', 'ledig stilling'],
    en: ['job', 'jobs', 'vacancy'],
  },
  it: {
    nb: ['utvikler', 'programmerer', 'devops', 'it-konsulent'],
    en: ['developer', 'programmer'],
  },
  helse: { nb: ['sykepleier', 'lege', 'helsefagarbeider'], en: ['nurse', 'doctor'] },
  bygg: {
    nb: ['tømrer', 'elektriker', 'rørlegger', 'snekker'],
    en: ['carpenter', 'electrician', 'plumber'],
  },
  undervisning: { nb: ['lærer', 'lektor', 'barnehagelærer'], en: ['teacher'] },
  handel: { nb: ['butikkmedarbeider', 'selger', 'kasserer'], en: ['sales assistant', 'cashier'] },
  transport: { nb: ['sjåfør', 'lastebilsjåfør', 'bud'], en: ['driver'] },
  kontor: { nb: ['sekretær', 'regnskap', 'økonomi'], en: ['accountant'] },
  industri: { nb: ['operatør', 'industri', 'produksjon'], en: ['operator'] },
  reiseliv: { nb: ['kokk', 'servitør', 'resepsjonist'], en: ['chef', 'cook', 'waiter'] },
  reise: { nb: ['reise', 'ferie'], en: ['travel', 'holiday'] },
  hytteutleie: { nb: ['hytte til leie', 'hytteutleie'], en: ['cabin rental'] },
  leilighet: { nb: ['ferieleilighet', 'korttidsleie'], en: ['holiday apartment', 'short stay'] },
  pakkereise: { nb: ['pakkereise', 'charter', 'sydentur'], en: ['package holiday'] },
};

/**
 * Makes and models that imply a category but stay in the text query: "land cruiser v8" searches cars
 * for "land cruiser v8" (the words describe which car, unlike "car" itself).
 */
export const HINT_WORDS: Readonly<Record<string, Words>> = {
  cars: {
    en: [
      'toyota',
      'land cruiser',
      'landcruiser',
      'hilux',
      'vitz',
      'noah',
      'mark x',
      'corolla',
      'probox',
      'nissan',
      'patrol',
      'pajero',
      'mitsubishi',
      'suzuki',
      'hyundai',
      'mercedes',
    ],
  },
  motorcycles: { en: ['bajaj boxer', 'tvs'] },
  'trucks-buses': { en: ['isuzu', 'coaster', 'canter'] },
  elektronikk: {
    nb: ['iphone', 'samsung', 'macbook', 'playstation', 'xbox', 'airpods'],
    en: ['iphone', 'samsung', 'macbook', 'playstation', 'xbox', 'airpods'],
  },
  personbil: {
    nb: ['volvo', 'tesla', 'toyota', 'volkswagen', 'vw', 'golf', 'bmw', 'audi', 'skoda', 'corolla'],
  },
};

/** A value people name by itself; `also` is the category or subcategory it implies (iPhone → phones). */
export interface ValueWords {
  words: Words;
  also?: string;
}

/** Words for select-attribute values, by attribute key and value. Applied only where the attribute exists. */
export const VALUE_WORDS: Readonly<Record<string, Readonly<Record<string, ValueWords>>>> = {
  fuel: {
    // "elbil" is also a car (NODE_WORDS): a phrase listed twice means both.
    electric: {
      words: { en: ['electric', 'ev'], nb: ['elektrisk', 'elbil', 'elbiler'], so: ['koronto'] },
    },
    hybrid: { words: { en: ['hybrid'], nb: ['hybrid', 'ladbar hybrid'], so: ['haybrid'] } },
    diesel: { words: { en: ['diesel'], nb: ['diesel'], so: ['naafto'] } },
    petrol: { words: { en: ['petrol', 'gasoline'], nb: ['bensin'], so: ['baansiin'] } },
  },
  gearbox: {
    automatic: {
      words: { en: ['automatic', 'auto'], nb: ['automat', 'automatgir'], so: ['otomaatig'] },
    },
    manual: { words: { en: ['manual'], nb: ['manuell', 'manuelt gir'] } },
  },
  usage: {
    brand_new: { words: { en: ['brand new'], so: ['cusub'] }, also: 'vehicles' },
    foreign_used: {
      words: { en: ['foreign used', 'imported'], so: ['dibadda laga keenay'] },
      also: 'vehicles',
    },
    locally_used: {
      words: { en: ['locally used', 'local used'], so: ['gudaha lagu isticmaalay'] },
      also: 'vehicles',
    },
  },
  steering: {
    right: {
      words: { en: ['right hand drive', 'right-hand drive', 'rhd'], so: ['shukaan midig'] },
      also: 'cars',
    },
    left: {
      words: { en: ['left hand drive', 'left-hand drive', 'lhd'], so: ['shukaan bidix'] },
      also: 'cars',
    },
  },
  condition: {
    new: {
      words: { en: ['new', 'brand new', 'unused'], nb: ['ny', 'nye', 'ubrukt'], so: ['cusub'] },
    },
    like_new: {
      words: { en: ['like new', 'as new'], nb: ['som ny', 'pent brukt'], so: ['sida cusub'] },
    },
  },
  brand: {
    apple: { words: { en: ['iphone', 'iphones', 'apple'] }, also: 'mobile-phones' },
    samsung: { words: { en: ['samsung', 'galaxy'] }, also: 'phones' },
    tecno: { words: { en: ['tecno'] }, also: 'phones' },
    infinix: { words: { en: ['infinix'] }, also: 'phones' },
    xiaomi: { words: { en: ['xiaomi', 'redmi'] }, also: 'phones' },
    huawei: { words: { en: ['huawei'] }, also: 'phones' },
    oppo: { words: { en: ['oppo'] }, also: 'phones' },
    nokia: { words: { en: ['nokia'] }, also: 'phones' },
    itel: { words: { en: ['itel'] }, also: 'phones' },
  },
  itemType: {
    laptop: {
      words: { en: ['laptop', 'laptops', 'notebook'], so: ['laabtoob'] },
      also: 'computers',
    },
    printer: { words: { en: ['printer', 'printers'] }, also: 'computers' },
    monitor: { words: { en: ['monitor', 'monitors'] }, also: 'computers' },
    panel: {
      words: { en: ['solar panel', 'solar panels', 'panel', 'panels'] },
      also: 'solar-power',
    },
    battery: {
      words: { en: ['battery', 'batteries', 'lithium battery'], so: ['baytari', 'baytariyo'] },
      also: 'solar-power',
    },
    inverter: { words: { en: ['inverter', 'inverters'] }, also: 'solar-power' },
    kit: { words: { en: ['solar kit', 'solar kits'] }, also: 'solar-power' },
    light: { words: { en: ['solar light', 'street light'] }, also: 'solar-power' },
    fridge: {
      words: { en: ['fridge', 'fridges', 'refrigerator'], so: ['talaagad', 'talaajad'] },
      also: 'appliances',
    },
    air_conditioner: {
      words: { en: ['air conditioner', 'aircon', 'ac'], so: ['qaboojiye'] },
      also: 'appliances',
    },
    washing_machine: { words: { en: ['washing machine', 'washer'] }, also: 'appliances' },
    fan: { words: { en: ['fan', 'fans'], so: ['marawaxad'] }, also: 'appliances' },
  },
  employmentType: {
    full_time: {
      words: {
        en: ['full time', 'full-time'],
        nb: ['heltid', 'fast stilling'],
        so: ['waqti buuxa'],
      },
    },
    part_time: { words: { en: ['part time', 'part-time'], nb: ['deltid'], so: ['waqti dhiman'] } },
  },
  furnishing: {
    furnished: { words: { en: ['furnished'], so: ['alaab leh'] } },
  },
};

/** Words that ask for the cheapest first. */
export const CHEAP_WORDS: Words = {
  en: ['cheap', 'cheapest', 'budget', 'affordable', 'bargain'],
  nb: ['billig', 'billige', 'billigste', 'rimelig'],
  so: ['jaban', 'raqiis', 'qiimo jaban'],
};

/** Words that say the price ceiling follows ("under 500"). */
export const MAX_PRICE_WORDS: Words = {
  en: ['under', 'below', 'less than', 'max', 'up to', 'maximum'],
  nb: ['under', 'maks', 'maksimum', 'opp til', 'inntil'],
  so: ['ilaa', 'ka yar', 'ugu badnaan'],
};

/** Words that say the price floor follows ("over 500"). */
export const MIN_PRICE_WORDS: Words = {
  en: ['over', 'above', 'more than', 'from', 'min'],
  nb: ['over', 'fra', 'minst'],
  so: ['ka badan', 'laga bilaabo'],
};

/** Words that only connect others ("for", "in", "til salgs"): dropped from the text once understood. */
export const FILLER_WORDS: Words = {
  en: [
    'for',
    'in',
    'near',
    'at',
    'with',
    'the',
    'a',
    'an',
    'for sale',
    'sale',
    'selling',
    'buy',
    'used',
  ],
  nb: ['i', 'på', 'til salgs', 'selges', 'ved', 'nær', 'brukt', 'kjøpe'],
  so: ['iib', 'iib ah', 'ah', 'ku', 'ee', 'oo', 'iyo', 'magaalada', 'la iibiyo'],
};

/** Words that mean the same in a search (applied at search time on the language fields). */
export const SYNONYMS: Partial<Record<Locale, readonly string[]>> = {
  en: [
    'fridge, refrigerator',
    'tv, television',
    'phone, mobile, smartphone, cellphone',
    'laptop, notebook',
    'sofa, couch',
    'tyre, tire',
    'tyres, tires',
    'bike, bicycle',
    'car, automobile',
  ],
  so: ['taleefan, mobaayil, telefoon', 'baabuur, gaari, gaadhi', 'talaagad, talaajad'],
  nb: ['mobil, mobiltelefon, telefon', 'sofa, sofaer', 'elbil, elektrisk bil'],
};
