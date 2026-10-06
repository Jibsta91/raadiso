'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { openPalette } from './command-palette';

/**
 * Keyboard navigation for the console: "g" then a letter opens a section (g u → users), "/"
 * opens search, "?" lists the shortcuts. Ignored while typing in a field.
 */
export function Hotkeys({
  sections,
  extra = [],
}: {
  sections: Array<{ key: string; href: string; label: string }>;
  extra?: Array<{ keys: string; label: string }>;
}) {
  const t = useTranslations('admin.shortcuts');
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let chord = false;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        el.closest('input,textarea,select,[contenteditable]')
      )
        return;
      if (document.querySelector('dialog[open]') && e.key !== '?') return;
      if (chord) {
        chord = false;
        setPending(false);
        clearTimeout(timer);
        const target = sections.find((s) => s.key === e.key);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (e.key === 'g') {
        chord = true;
        setPending(true);
        timer = setTimeout(() => {
          chord = false;
          setPending(false);
        }, 1200);
      } else if (e.key === '/') {
        e.preventDefault();
        openPalette();
      } else if (e.key === '?') {
        e.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else dialog.current?.showModal();
      }
    };
    const show = () => dialog.current?.showModal();
    window.addEventListener('keydown', onKey);
    window.addEventListener('raadi:shortcuts', show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('raadi:shortcuts', show);
      clearTimeout(timer);
    };
  }, [sections, router]);

  const rows = [
    { keys: '⌘ K', label: t('palette') },
    { keys: '/', label: t('search') },
    { keys: '?', label: t('help') },
    ...sections.map((s) => ({ keys: `g ${s.key}`, label: s.label })),
    ...extra,
  ];

  return (
    <>
      {pending ? (
        <div
          aria-live="polite"
          className="fixed bottom-4 end-4 z-40 rounded-full bg-ink px-3 py-1.5 font-mono text-xs text-ink-foreground shadow-float"
        >
          g …
        </div>
      ) : null}
      <dialog
        ref={dialog}
        aria-label={t('title')}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-3xl border bg-card p-6 text-card-foreground shadow-float backdrop:bg-black/40"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        data-testid="shortcuts-dialog"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('title')}</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded-full p-1.5 hover:bg-accent"
            aria-label={t('close')}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
          {rows.map((r) => (
            <div key={r.keys} className="contents">
              <dt className="flex gap-1">
                {r.keys.split(' ').map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 bg-card px-1.5 font-mono text-xs font-semibold"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{r.label}</dd>
            </div>
          ))}
        </dl>
      </dialog>
    </>
  );
}
