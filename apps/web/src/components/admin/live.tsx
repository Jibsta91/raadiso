'use client';

import { cn } from '@raadi/ui';
import { Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * Refreshes the page's server data every `seconds` while the tab is visible (no websockets
 * needed: server components re-render). Shows when it last updated; can be paused.
 */
export function LiveRefresh({ seconds = 30 }: { seconds?: number }) {
  const t = useTranslations('admin.live');
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [updated, setUpdated] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (paused) return;
    const refresh = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setUpdated(Date.now());
    }, seconds * 1000);
    return () => clearInterval(refresh);
  }, [paused, seconds, router]);

  const ago = Math.max(0, Math.round((now - updated) / 1000));
  return (
    <button
      type="button"
      onClick={() => setPaused((p) => !p)}
      className="inline-flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-xs font-medium hover:bg-accent"
      aria-pressed={!paused}
      title={paused ? t('resume') : t('pause')}
      data-testid="live-refresh"
    >
      <span className="relative flex size-2">
        {!paused ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        ) : null}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            paused ? 'bg-muted-foreground' : 'bg-success',
          )}
        />
      </span>
      {paused ? t('paused') : t('updated', { seconds: ago })}
      {paused ? <Play aria-hidden className="size-3" /> : <Pause aria-hidden className="size-3" />}
    </button>
  );
}
