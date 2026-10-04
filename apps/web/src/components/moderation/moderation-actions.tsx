'use client';

import { Button } from '@raadi/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { dismissReports, removeListing } from '@/app/[locale]/admin/moderation/actions';

/** Remove the listing (the owner is told; its reports are resolved) or dismiss its reports. */
export function ModerationActions({ listingId, removed }: { listingId: string; removed: boolean }) {
  const t = useTranslations('moderation');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(kind: 'remove' | 'dismiss') {
    if (kind === 'remove' && !window.confirm(t('confirmRemove'))) return;
    setBusy(true);
    setFailed(false);
    // Server actions: they run with the admin session; the page refreshes when they succeed.
    const ok = await (
      kind === 'remove' ? removeListing(listingId) : dismissReports(listingId)
    ).catch(() => false);
    setBusy(false);
    setFailed(!ok);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {removed ? null : (
        <Button
          size="sm"
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          disabled={busy}
          onClick={() => void act('remove')}
          data-testid="moderation-remove"
        >
          {t('remove')}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void act('dismiss')}
        data-testid="moderation-dismiss"
      >
        {t('dismiss')}
      </Button>
      {failed ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {t('failed')}
        </p>
      ) : null}
    </div>
  );
}
