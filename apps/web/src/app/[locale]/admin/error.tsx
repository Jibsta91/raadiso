'use client';

import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** A console page failed to load (a service is down or times out): try again, or go to the start. */
// The server has logged the error; the browser gets no details.
export default function AdminPageError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  return (
    <div className="py-24 text-center" role="alert" data-testid="page-error">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('body')}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 font-medium text-primary-foreground"
          data-testid="page-error-retry"
        >
          <RotateCcw aria-hidden className="size-4" />
          {t('retry')}
        </button>
        <Link href="/admin" className="text-primary underline-offset-4 hover:underline">
          {t('console')}
        </Link>
      </div>
    </div>
  );
}
