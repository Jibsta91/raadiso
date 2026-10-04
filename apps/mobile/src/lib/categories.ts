import type { IconName } from '../components/icon';
import {
  CATEGORIES as TAXONOMY,
  CATEGORY_KEYS,
  type Category,
  type Subcategory,
} from '@raadi/catalog/categories';

// Categories and subcategories come from @raadi/catalog (the zod-free part); names live in the
// i18n catalogue.
export const CATEGORIES = CATEGORY_KEYS;
export type CategoryId = Category;
export type SubcategoryId = Subcategory;

export function isCategory(value: string | undefined): value is CategoryId {
  return (CATEGORIES as readonly string[]).includes(value ?? '');
}

export function subcategoriesOf(category: CategoryId): readonly SubcategoryId[] {
  return TAXONOMY[category];
}

export function isSubcategoryOf(
  category: CategoryId | undefined,
  value: string | undefined,
): value is SubcategoryId {
  return !!category && (TAXONOMY[category] as readonly string[]).includes(value ?? '');
}

export const CATEGORY_ICONS: Record<CategoryId, IconName> = {
  torget: 'bag-handle-outline',
  bil: 'car-outline',
  eiendom: 'home-outline',
  jobb: 'briefcase-outline',
  reise: 'airplane-outline',
};

export const SUBCATEGORY_ICONS: Record<SubcategoryId, IconName> = {
  elektronikk: 'phone-portrait-outline',
  mobler: 'bed-outline',
  klaer: 'shirt-outline',
  sport: 'bicycle-outline',
  barn: 'happy-outline',
  hobby: 'musical-notes-outline',
  hage: 'leaf-outline',
  antikviteter: 'color-palette-outline',
  dyr: 'paw-outline',
  kjoretoyutstyr: 'construct-outline',
  personbil: 'car-sport-outline',
  varebil: 'bus-outline',
  motorsykkel: 'speedometer-outline',
  bobil: 'trail-sign-outline',
  salg: 'key-outline',
  utleie: 'home-outline',
  fritid: 'earth-outline',
  tomt: 'map-outline',
  nybygg: 'hammer-outline',
  naering: 'business-outline',
  it: 'laptop-outline',
  helse: 'medkit-outline',
  bygg: 'build-outline',
  undervisning: 'school-outline',
  handel: 'cart-outline',
  transport: 'bus-outline',
  kontor: 'briefcase-outline',
  industri: 'construct-outline',
  reiseliv: 'restaurant-outline',
  hytteutleie: 'bonfire-outline',
  leilighet: 'bed-outline',
  pakkereise: 'airplane-outline',
};
