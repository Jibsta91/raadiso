import { X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { href, type Params, selected, toggleValue, withParams } from '@/lib/search-params';

export interface Chip {
  /** Stable id for tests: `<param>-<value>` or the range parameter. */
  id: string;
  label: string;
  /** The search with this filter removed. */
  remove: Params;
}

/** Removable chips for every active filter, FINN-style, above the results. */
export function ActiveFilters({
  chips,
  clear,
  clearLabel,
  removeLabel,
}: {
  chips: Chip[];
  clear: Params;
  clearLabel: string;
  removeLabel: (filter: string) => string;
}) {
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" role="list" data-testid="active-filters">
      {chips.map((c) => (
        <li key={c.id}>
          <Link
            href={href(c.remove)}
            scroll={false}
            aria-label={removeLabel(c.label)}
            data-testid={`chip-${c.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink ps-3.5 pe-2.5 text-sm font-medium text-ink-foreground motion-safe:transition-opacity hover:opacity-85 focus-ring"
          >
            {c.label}
            <X aria-hidden className="size-3.5" />
          </Link>
        </li>
      ))}
      <li>
        <Link
          href={href(clear)}
          scroll={false}
          className="px-2 text-sm font-medium text-primary hover:underline"
        >
          {clearLabel}
        </Link>
      </li>
    </ul>
  );
}

/** One chip per selected value of a multi-value facet. */
export function facetChips(params: Params, key: string, label: (value: string) => string): Chip[] {
  return selected(params, key).map((value) => ({
    id: `${key}-${value}`,
    label: label(value),
    remove: toggleValue(params, key, value),
  }));
}

/** A chip for a single-value parameter (a range bound). */
export function paramChip(params: Params, key: string, label: string): Chip[] {
  return params[key] ? [{ id: key, label, remove: withParams(params, { [key]: undefined }) }] : [];
}
