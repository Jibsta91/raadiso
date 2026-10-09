'use client';

import { RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';

/**
 * Renew: moves an active listing back to the top, at most once a week (ADR-0045). Before that, says
 * from when it can be renewed.
 */
export function RenewButton({ id, renewableAt }: { id: string; renewableAt: string }) {
  const t = useTranslations('my');
  const format = useFormatter();
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const from = new Date(renewableAt);

  if (from.getTime() > Date.now() && state !== 'done') {
    return (
      <span className="text-xs text-muted-foreground" data-testid="renew-later">
        {t('renewFrom', { date: format.dateTime(from, { dateStyle: 'medium' }) })}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="renew"
      disabled={state === 'busy' || state === 'done'}
      onClick={async () => {
        setState('busy');
        const res = await fetch(`/api/v1/listings/${id}/renew`, { method: 'POST' }).catch(
          () => null,
        );
        setState(res?.ok ? 'done' : 'error');
        if (res?.ok) router.refresh();
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium hover:bg-accent disabled:opacity-60"
    >
      <RefreshCw aria-hidden className="size-3.5" />
      {state === 'done' ? t('renewed') : state === 'error' ? t('renewFailed') : t('renew')}
    </button>
  );
}
