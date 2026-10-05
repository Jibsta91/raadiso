'use client';

import { cn } from '@raadi/ui';
import {
  ArrowRight,
  CornerDownLeft,
  FileText,
  History,
  Keyboard,
  LogOut,
  Package,
  Receipt,
  Search,
  SunMoon,
  User,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { type PaletteHit, paletteSearch } from '@/app/[locale]/admin/actions';
import { useRouter } from '@/i18n/navigation';
import { THEME_COOKIE } from '@/lib/theme';

export interface PaletteNav {
  href: string;
  label: string;
  group: string;
  keys: string;
}

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: typeof Search;
  run: () => void;
  hint?: string;
}

const RECENT_KEY = 'raadi.admin.recent';
const KIND_ICON = { user: User, listing: Package, order: Receipt } as const;

/** Remembers what the person opened recently (this browser only), for ⌘K. */
export function rememberRecent(hit: Omit<PaletteHit, 'subtitle'> & { subtitle?: string }) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as PaletteHit[];
    const next = [{ subtitle: '', ...hit }, ...list.filter((h) => h.href !== hit.href)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private windows); recents are a convenience.
  }
}

function readRecent(): PaletteHit[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as PaletteHit[];
  } catch {
    return [];
  }
}

/** Opens the command palette from anywhere (the header button, the "/" key). */
export const openPalette = () => window.dispatchEvent(new Event('raadi:palette'));

/**
 * ⌘K / Ctrl K: jump to a section, find a user, listing or order (within the person's roles), or
 * run a console command. Arrow keys move, Enter opens, Esc closes.
 */
export function CommandPalette({ nav, canSearch }: { nav: PaletteNav[]; canSearch: boolean }) {
  const t = useTranslations('admin.palette');
  const locale = useLocale();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [hits, setHits] = useState<PaletteHit[]>([]);
  const [recent, setRecent] = useState<PaletteHit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, startSearch] = useTransition();

  const open = useCallback(() => {
    setRecent(readRecent());
    setQuery('');
    setActive(0);
    dialog.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (dialog.current?.open) close();
        else open();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('raadi:palette', open);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('raadi:palette', open);
    };
  }, [open, close]);

  useEffect(() => {
    if (!canSearch || deferred.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const timer = setTimeout(
      () =>
        startSearch(async () => {
          const found = await paletteSearch(deferred).catch(() => []);
          if (live) setHits(found);
        }),
      180,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [deferred, canSearch]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const commands: Item[] = [
      {
        id: 'cmd-theme',
        group: t('commands'),
        title: t('toggleTheme'),
        icon: SunMoon,
        run: () => {
          const root = document.documentElement;
          const dark =
            root.dataset.theme === 'dark' ||
            (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
          const next = dark ? 'light' : 'dark';
          root.dataset.theme = next;
          document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
          close();
        },
      },
      {
        id: 'cmd-keys',
        group: t('commands'),
        title: t('shortcuts'),
        icon: Keyboard,
        hint: '?',
        run: () => {
          close();
          window.dispatchEvent(new Event('raadi:shortcuts'));
        },
      },
      {
        id: 'cmd-logout',
        group: t('commands'),
        title: t('logout'),
        icon: LogOut,
        run: () =>
          (document.getElementById('admin-logout-form') as HTMLFormElement | null)?.submit(),
      },
    ];
    return [
      ...hits.map((h) => ({
        id: `hit-${h.kind}-${h.id}`,
        group: t(`kinds.${h.kind}`),
        title: h.title,
        subtitle: h.subtitle,
        icon: KIND_ICON[h.kind],
        run: () => go(h.href),
      })),
      ...(q ? [] : recent).map((h) => ({
        id: `recent-${h.href}`,
        group: t('recent'),
        title: h.title,
        subtitle: h.subtitle,
        icon: History,
        run: () => go(h.href),
      })),
      ...nav
        .filter((n) => match(n.label))
        .map((n) => ({
          id: `nav-${n.href}`,
          group: t('goTo'),
          title: n.label,
          subtitle: n.group,
          icon: FileText,
          hint: n.keys,
          run: () => go(n.href),
        })),
      ...commands.filter((c) => match(c.title)),
    ];
  }, [query, hits, recent, nav, t, go, close]);

  useEffect(() => setActive(0), [items.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  };

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  let lastGroup = '';
  return (
    <dialog
      ref={dialog}
      aria-label={t('label')}
      className="mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border bg-card p-0 text-card-foreground shadow-float backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      onClick={(e) => e.target === dialog.current && close()}
      data-testid="command-palette"
      lang={locale}
    >
      <div className="flex items-center gap-3 border-b px-4">
        <Search aria-hidden className="size-5 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={canSearch ? t('placeholder') : t('placeholderNav')}
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
          data-testid="palette-input"
        />
        {searching ? (
          <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
        ) : null}
      </div>
      <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
        {items.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">{t('nothing')}</li>
        ) : null}
        {items.map((item, i) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          const Icon = item.icon;
          return (
            <li key={item.id} role="presentation">
              {header ? (
                <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {header}
                </p>
              ) : null}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => item.run()}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2',
                  i === active && 'bg-accent',
                )}
                data-testid="palette-item"
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  {item.subtitle ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.subtitle}
                    </span>
                  ) : null}
                </span>
                {item.hint ? (
                  <span className="font-mono text-[11px] text-muted-foreground">{item.hint}</span>
                ) : null}
                {i === active ? (
                  <CornerDownLeft aria-hidden className="size-3.5 text-muted-foreground" />
                ) : (
                  <ArrowRight aria-hidden className="size-3.5 opacity-0" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <span>↑↓ {t('move')}</span>
        <span>↵ {t('open')}</span>
        <span>esc {t('close')}</span>
      </div>
    </dialog>
  );
}
