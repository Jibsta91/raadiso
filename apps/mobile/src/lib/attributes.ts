import type { Messages } from '../i18n/messages';

type TaxonomyMessages = Messages['taxonomy'];

/** Numeric attributes shown with thousands separators (and a unit). */
const UNITS: Record<string, string> = { mileageKm: 'km', areaM2: 'm²' };

export interface AttributeRow {
  key: string;
  label: string;
  value: string;
}

/**
 * A listing's attributes as label/value rows for the key-info box, in the order the seller's
 * category defines them. Enum values are translated, numbers formatted; unknown keys keep
 * their raw form, so a newer server never breaks an older app.
 */
export function attributeRows(
  attributes: Record<string, string | number | boolean>,
  taxonomy: TaxonomyMessages,
  intlTag: string,
): AttributeRow[] {
  const labels = taxonomy.attributes as Record<string, string>;
  const values = taxonomy.values as Record<string, Record<string, string> | undefined>;
  const number = new Intl.NumberFormat(intlTag, { maximumFractionDigits: 0 });
  return Object.entries(attributes).map(([key, raw]) => {
    let value = String(raw);
    const translated = values[key]?.[value];
    if (translated) value = translated;
    else if (UNITS[key] && typeof raw === 'number') value = `${number.format(raw)} ${UNITS[key]}`;
    return { key, label: labels[key] ?? key, value };
  });
}
