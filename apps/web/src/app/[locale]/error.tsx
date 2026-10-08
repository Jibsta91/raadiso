'use client';

import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { reportError } from '@/components/error-reporting';
import { Link } from '@/i18n/navigation';

/**
 * When a page fails to load (a service is down or times out), in the visitor's language and with a way
 * to try again, instead of the framework's English error screen.
 */
// The server has logged the error (with the digest Next.js shows); the browser gets no details. Errors
// that happened in the browser go to GlitchTip (ADR-0038).
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  useEffect(() => reportError(error), [error]);
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
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          {t('home')}
        </Link>
      </div>
    </div>
  );
}
