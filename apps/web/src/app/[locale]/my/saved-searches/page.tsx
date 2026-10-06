import { Button } from '@raadi/ui';
import { Bookmark, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SavedSearchActions } from '@/components/saved/saved-search-controls';
import { Link } from '@/i18n/navigation';
import { markSavedSearchSeen, savedSearches, ServiceUnavailableError } from '@/lib/api';
import { searchLabels } from '@/lib/search-labels';
import { href } from '@/lib/search-params';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('savedSearches');
  return { title: t('title'), robots: { index: false } };
}

/**
 * The signed-in user's saved searches (ADR-0026). `?open=<id>` (from alerts and the list)
 * resets the search's "new" count and goes to its results.
 */
export default async function SavedSearchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const [{ locale }, { open }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    const back = `/${locale}/my/saved-searches${open ? `?open=${encodeURIComponent(open)}` : ''}`;
    redirect(`/auth/login?returnTo=${encodeURIComponent(back)}&locale=${locale}`);
  }
  if (open && UUID.test(open)) {
    const opened = await markSavedSearchSeen(open);
    if (opened) redirect(`/${locale}${href({ ...opened.params, sort: 'newest' })}`);
  }
  const t = await getTranslations('savedSearches');
  let items;
  try {
    items = (await savedSearches()) ?? [];
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
        {t('unavailable')}
      </div>
    );
  }
  const described = await Promise.all(items.map((s) => searchLabels(s.params)));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      {items.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 py-16 text-center"
          data-testid="saved-searches-empty"
        >
          <Bookmark aria-hidden className="size-10 text-muted-foreground" />
          <p className="max-w-sm text-muted-foreground">{t('empty')}</p>
          <Button asChild variant="outline">
            <Link href="/search">{t('browse')}</Link>
          </Button>
        </div>
      ) : (
        <ul
          className="divide-y overflow-hidden rounded-3xl border bg-card"
          role="list"
          data-testid="saved-searches"
        >
          {items.map((s, i) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap"
              data-testid="saved-search"
            >
              <Link
                href={`/my/saved-searches?open=${s.id}`}
                prefetch={false}
                className="group min-w-0 flex-1 space-y-1.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold group-hover:underline">{s.name}</span>
                  {s.newCount > 0 ? (
                    <span
                      className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground"
                      data-testid="saved-search-new"
                    >
                      {t('new', { count: s.newCount })}
                    </span>
                  ) : null}
                  <ChevronRight
                    aria-hidden
                    className="ms-auto size-4 shrink-0 text-muted-foreground sm:hidden"
                  />
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {described[i]!.map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-soft px-2.5 py-0.5 text-xs text-soft-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </span>
              </Link>
              <SavedSearchActions id={s.id} notify={s.notify} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
