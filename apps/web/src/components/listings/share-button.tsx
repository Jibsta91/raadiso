'use client';

import { Check, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** The phone's share sheet where there is one; otherwise the link is copied. */
export function ShareButton({ title }: { title: string }) {
  const t = useTranslations('listing');
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      // Closing the share sheet rejects; that is not an error.
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };
  return (
    <button
      type="button"
      onClick={() => void share()}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium hover:bg-muted"
      data-testid="listing-share"
    >
      {copied ? (
        <Check aria-hidden className="size-4" />
      ) : (
        <Share2 aria-hidden className="size-4" />
      )}
      <span aria-live="polite">{copied ? t('shareCopied') : t('share')}</span>
    </button>
  );
}
