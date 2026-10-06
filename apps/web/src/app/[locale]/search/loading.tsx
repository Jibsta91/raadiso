import { getTranslations } from 'next-intl/server';

/** Shown while the page loads (streamed first), so a slow service never leaves a blank screen. */
export default async function Loading() {
  const t = await getTranslations('errors');
  return (
    <div aria-busy="true" data-testid="loading-search">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <div aria-hidden className="mb-6 h-12 w-full animate-pulse rounded-2xl bg-muted" />
      <ul aria-hidden className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-6 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="space-y-2">
            <div className="aspect-[4/3] animate-pulse rounded-2xl bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}
