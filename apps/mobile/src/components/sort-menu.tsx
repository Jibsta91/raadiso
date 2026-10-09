import { useI18n } from '../i18n';
import type { Sort } from '../lib/sort';
import { Chip } from './ui';

/** Sorting for search results (Android and the web): a chip that steps through the orders. */
export function SortMenu({
  value,
  options,
  onChange,
}: {
  value: Sort;
  options: readonly Sort[];
  onChange: (sort: Sort) => void;
}) {
  const { m } = useI18n();
  const labels = m.sort as Record<string, string>;
  const next = options[(options.indexOf(value) + 1) % options.length] ?? 'relevance';
  return (
    <Chip
      testID="sort"
      label={`${m.sort.label}: ${labels[value] ?? value}`}
      selected={value !== 'relevance'}
      onPress={() => onChange(next)}
    />
  );
}
