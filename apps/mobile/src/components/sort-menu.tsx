import { useI18n } from '../i18n';
import { Chip } from './ui';

export const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];

/** Sorting for search results (Android and the web): a chip that steps through the orders. */
export function SortMenu({ value, onChange }: { value: Sort; onChange: (sort: Sort) => void }) {
  const { m } = useI18n();
  const next = SORTS[(SORTS.indexOf(value) + 1) % SORTS.length]!;
  return (
    <Chip
      testID="sort"
      label={`${m.sort.label}: ${m.sort[value]}`}
      selected={value !== 'relevance'}
      onPress={() => onChange(next)}
    />
  );
}
