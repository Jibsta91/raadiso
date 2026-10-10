import type { FacetValue } from '@raadi/api-client';
import { Check, ChevronDown } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { href, type Params, selected, toggleValue } from '@/lib/search-params';

/** Values shown before "Show all": long lists (counties, makes) fold away, FINN-style. */
const VISIBLE = 6;

/**
 * One facet as a collapsible group of toggle links (works without JavaScript: <details> and
 * plain links).
 */
export function FacetGroup({
  name,
  title,
  values,
  params,
  label,
  showAll,
}: {
  name: string;
  title: string;
  values: FacetValue[];
  params: Params;
  label: (value: string) => string;
  showAll: (count: number) => string;
}) {
  const active = selected(params, name);
  const shown = values.filter((v) => v.count > 0 || active.includes(v.value));
  if (shown.length === 0) return null;
  // Selected values always stay visible, even when they would fall past the fold.
  const first = shown.filter((v, i) => i < VISIBLE || active.includes(v.value));
  const rest = shown.filter((v) => !first.includes(v));

  const item = (v: FacetValue) => {
    const on = active.includes(v.value);
    return (
      <li key={v.value}>
        <Link
          href={href(toggleValue(params, name, v.value))}
          role="checkbox"
          aria-checked={on}
          className="flex items-center gap-2.5 rounded-card px-1.5 py-1 text-sm hover:bg-accent"
          data-testid={`facet-${name}-${v.value}`}
          scroll={false}
        >
          <span
            className={`flex size-[18px] shrink-0 items-center justify-center rounded-field border ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card'}`}
          >
            {on ? <Check aria-hidden className="size-3" /> : null}
          </span>
          <span className={`flex-1 ${on ? 'font-semibold' : ''}`}>{label(v.value)}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{v.count}</span>
        </Link>
      </li>
    );
  };

  return (
    <details open className="group border-b pb-3" data-testid={`facet-${name}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {active.length ? (
            <span className="ms-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
              {active.length}
            </span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden
          className="size-4 text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
      </summary>
      <ul className="space-y-0.5">{first.map(item)}</ul>
      {rest.length ? (
        <details className="group/more">
          <summary className="mt-1 inline-flex cursor-pointer list-none rounded px-1.5 py-1 text-sm font-medium text-primary hover:underline group-open/more:hidden [&::-webkit-details-marker]:hidden">
            {showAll(shown.length)}
          </summary>
          <ul className="space-y-0.5">{rest.map(item)}</ul>
        </details>
      ) : null}
    </details>
  );
}
