import { z } from 'zod';
import {
  attributesOf,
  CATEGORY_KEYS,
  isCategory,
  type AttributeDef,
  type Category,
  type Subcategory,
} from './categories.js';

export * from './attribute-values.js';
export * from './attributes.js';
export * from './categories.js';
export * from './countries.js';
export * from './money.js';

export const categorySchema = z
  .string()
  .min(1)
  .max(40)
  .refine(isCategory, { message: 'unknown category' });

function fieldSchema(def: AttributeDef): z.ZodType {
  const s =
    def.kind === 'select'
      ? z.enum(def.options as [string, ...string[]])
      : def.kind === 'text'
        ? z.string().trim().min(1).max(def.maxLength)
        : z.number().int().min(def.min).max(def.max);
  return def.required ? s : s.optional();
}

const schemas = new Map<string, z.ZodType<Record<string, string | number>>>();

/**
 * The attributes of a listing in a subcategory, generated from the taxonomy. Unknown keys are rejected
 * (strict). Unknown categories get a schema that accepts only an empty object.
 */
export function attributeSchema(
  category: Category,
  subcategory: Subcategory,
): z.ZodType<Record<string, string | number>> {
  const key = `${category}/${subcategory}`;
  let schema = schemas.get(key);
  if (!schema) {
    const defs = attributesOf(category, subcategory);
    schema = z
      .object(Object.fromEntries(defs.map((d) => [d.key, fieldSchema(d)])))
      .strict() as unknown as z.ZodType<Record<string, string | number>>;
    schemas.set(key, schema);
  }
  return schema;
}

/** Every category id, for OpenAPI enums and the console's filters. */
export const ALL_CATEGORIES = CATEGORY_KEYS;
