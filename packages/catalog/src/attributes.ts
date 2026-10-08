import { attributesOf, type Category, type Subcategory } from './categories.js';

/*
 * Attribute values and form helpers without zod: the app imports this module (@raadi/catalog/attributes)
 * to build the same listing form as the website. The definitions live in the taxonomy (categories.ts).
 */

export * from './attribute-values.js';
export type { AttributeDef } from './categories.js';
export { attributesOf, facetsOf, rangesOf, priceRuleOf, priceUnitOf } from './categories.js';

/**
 * Form values (strings) to the API's attributes: empty fields left out, numbers converted.
 * Validation stays on the server (attributeSchema); this only shapes the payload.
 */
export function attributePayload(
  category: Category,
  subcategory: Subcategory,
  values: Record<string, string>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of attributesOf(category, subcategory)) {
    const raw = values[f.key]?.trim() ?? '';
    if (raw === '') continue;
    out[f.key] = f.kind === 'number' ? Number(raw) : raw;
  }
  return out;
}
