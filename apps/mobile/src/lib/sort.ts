import { BASE_SORTS, type Category, sortsOf } from '@raadi/catalog/categories';

/** A sort the search API accepts (base ones, and a category's own: ADR-0042). */
export type Sort = string;

/** The sorts on offer: a category's own when one is chosen. Distance needs a place, which the app's
 * search doesn't set, so it is left out. */
export function sortsFor(category?: Category, subcategory?: string): Sort[] {
  return (category ? sortsOf(category, subcategory) : [...BASE_SORTS]).filter(
    (s) => s !== 'distance',
  );
}
