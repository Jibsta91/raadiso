'use client';

import { Bell, BellOff, Bookmark, BookmarkCheck, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';

const loginRedirect = (locale: string) => {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/auth/login?returnTo=${encodeURIComponent(here)}&locale=${locale}`;
};

/** "Save search" on the results page; saved at once, then links to the saved searches. */
export function SaveSearchButton({
  name,
  params,
  initialSaved,
}: {
  name: string;
  params: Record<string, string>;
  initialSaved: boolean;
}) {
  const t = useTranslations('savedSearches');
  const locale = useLocale();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    initialSaved ? 'saved' : 'idle',
  );

  if (state === 'saved') {
    return (
      <Link
        href="/my/saved-searches"
        className="inline-flex h-10 items-center gap-2 rounded-full bg-soft px-4 text-sm font-semibold text-soft-foreground"
        data-testid="search-saved"
      >
        <BookmarkCheck aria-hidden className="size-4" />
        {t('saved')}
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={state === 'saving'}
      data-testid="save-search"
      onClick={async () => {
        setState('saving');
        const res = await fetch('/api/v1/saved/searches', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, params, notify: true }),
        }).catch(() => null);
        if (res?.status === 401) return loginRedirect(locale);
        setState(res?.ok ? 'saved' : 'error');
      }}
      className="inline-flex h-10 items-center gap-2 rounded-full border bg-card px-4 text-sm font-semibold motion-safe:transition-colors hover:bg-accent focus-ring disabled:opacity-60"
    >
      <Bookmark aria-hidden className="size-4" />
      {state === 'error' ? t('error') : t('save')}
    </button>
  );
}

/** Alert switch and delete for one saved search. */
export function SavedSearchActions({ id, notify }: { id: string; notify: boolean }) {
  const t = useTranslations('savedSearches');
  const router = useRouter();
  const [on, setOn] = useState(notify);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !on;
    setOn(next);
    const res = await fetch(`/api/v1/saved/searches/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notify: next }),
    }).catch(() => null);
    if (!res?.ok) setOn(!next);
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/v1/saved/searches/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        data-testid="saved-search-notify"
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-accent focus-ring"
      >
        {on ? <Bell aria-hidden className="size-4" /> : <BellOff aria-hidden className="size-4" />}
        {on ? t('alertsOn') : t('alertsOff')}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label={t('delete')}
        title={t('delete')}
        data-testid="saved-search-delete"
        className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive focus-ring"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </div>
  );
}
