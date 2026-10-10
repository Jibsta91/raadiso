'use client';

import type { Autocomplete } from '@raadi/api-client';
import { Clock, MapPin, Search, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';

const RECENT_KEY = 'raadi.recentSearches';
const RECENT_MAX = 5;

/** Recent searches live in this browser only (a convenience; never needed for anything to work). */
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function remember(q: string): void {
  const query = q.trim();
  if (!query) return;
  try {
    const next = [query, ...readRecent().filter((x) => x !== query)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private windows and blocked storage: no recent searches, nothing else changes.
  }
}

interface Option {
  id: string;
  kind: 'category' | 'query' | 'place' | 'recent';
  label: string;
  detail?: string;
  /** Where choosing it goes; queries are submitted with the form instead. */
  href?: string;
  query?: string;
}

/**
 * The search field with suggestions as you type (ADR-0041): categories with counts, completed searches,
 * places and, before typing, this browser's recent searches. An ARIA 1.2 combobox: arrow keys move,
 * Enter chooses, Escape closes. It sits inside a plain GET form, which works without JavaScript.
 */
export function SearchBox({
  country,
  name = 'q',
  defaultValue = '',
  placeholder,
  label,
  className,
  inputClassName,
  testId,
  autoFocus,
}: {
  country: string;
  name?: string;
  defaultValue?: string;
  placeholder: string;
  /** Accessible name (the visible placeholder is not a label). */
  label: string;
  className?: string;
  inputClassName?: string;
  testId?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [data, setData] = useState<Autocomplete | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  // Remember what is searched from this field's form.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const onSubmit = () => remember(input.current?.value ?? '');
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  // Suggestions for what is typed, debounced; an older answer never replaces a newer one.
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const url = `/api/v1/search/autocomplete?${new URLSearchParams({ q: q.slice(0, 60), country })}`;
      fetch(url, { signal: ctrl.signal })
        .then((res) => (res.ok ? (res.json() as Promise<Autocomplete>) : null))
        .then((next) => setData(next))
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [value, country]);

  const name_ = (category: string, subcategory?: string) =>
    subcategory
      ? t(`taxonomy.subcategories.${subcategory}` as never)
      : t(`taxonomy.categories.${category}` as never);

  const options: Option[] = value.trim()
    ? [
        ...(data?.categories ?? []).map((c) => ({
          id: `c-${c.subcategory ?? c.category}`,
          kind: 'category' as const,
          label: name_(c.category, c.subcategory),
          detail: c.subcategory
            ? `${t(`taxonomy.categories.${c.category}` as never)} · ${c.count}`
            : String(c.count),
          href: `/search?${new URLSearchParams({ category: c.category, ...(c.subcategory ? { subcategory: c.subcategory } : {}) })}`,
        })),
        ...(data?.queries ?? [])
          .filter((q) => q.toLowerCase() !== value.trim().toLowerCase())
          .map((q) => ({ id: `q-${q}`, kind: 'query' as const, label: q, query: q })),
        ...(data?.places ?? []).map((p) => ({
          id: `p-${p.placeId}`,
          kind: 'place' as const,
          label: p.name,
          detail: t('search.suggestions.nearby'),
          href: `/search?${new URLSearchParams({ near: p.placeId })}`,
        })),
      ]
    : recent.map((q) => ({ id: `r-${q}`, kind: 'recent' as const, label: q, query: q }));

  const shown = open && options.length > 0;

  function choose(option: Option) {
    setOpen(false);
    if (option.href) {
      remember(option.label);
      router.push(option.href);
      return;
    }
    if (option.query && input.current) {
      input.current.value = option.query;
      setValue(option.query);
      input.current.form?.requestSubmit();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : -1));
    } else if (e.key === 'Enter' && shown && active >= 0 && options[active]) {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const Icon = { category: Tag, query: Search, place: MapPin, recent: Clock };
  // Options grouped by kind, keeping their position in the arrow-key order.
  const groups: Array<{ kind: Option['kind']; items: Array<{ o: Option; i: number }> }> = [];
  options.forEach((o, i) => {
    const last = groups.at(-1);
    if (last?.kind === o.kind) last.items.push({ o, i });
    else groups.push({ kind: o.kind, items: [{ o, i }] });
  });

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        ref={input}
        name={name}
        type="search"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        maxLength={200}
        data-testid={testId}
        className={inputClassName}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => {
          setRecent(readRecent());
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={t('search.suggestions.title')}
        hidden={!shown}
        data-testid="search-suggestions"
        className="absolute inset-x-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-card border bg-card p-1.5 text-start shadow-float"
      >
        {groups.map((g) => (
          <li key={g.kind} role="presentation">
            <ul role="group" aria-label={t(`search.suggestions.${g.kind}`)}>
              <li
                role="presentation"
                aria-hidden
                className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t(`search.suggestions.${g.kind}`)}
              </li>
              {g.items.map(({ o, i }) => {
                const I = Icon[o.kind];
                return (
                  <li
                    key={o.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    data-testid={`suggestion-${o.kind}`}
                    // Before the input's blur: choose without losing the click.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(o);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`flex cursor-pointer items-center gap-3 rounded-card px-3 py-2 ${i === active ? 'bg-accent' : ''}`}
                  >
                    <I aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{o.label}</span>
                    {o.detail ? (
                      <span className="shrink-0 text-sm text-muted-foreground">{o.detail}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
