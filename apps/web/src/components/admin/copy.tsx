'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Copies a value (an id) to the clipboard. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useTranslations('admin');
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      className="inline-flex items-center gap-1 rounded-field px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      title={t('copy')}
      aria-label={`${t('copy')} ${label ?? value}`}
    >
      {label ?? value.slice(0, 8)}
      {done ? (
        <Check aria-hidden className="size-3 text-success" />
      ) : (
        <Copy aria-hidden className="size-3" />
      )}
    </button>
  );
}
