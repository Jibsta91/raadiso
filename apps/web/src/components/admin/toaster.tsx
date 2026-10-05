'use client';

import { cn } from '@raadi/ui';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

type Tone = 'good' | 'bad' | 'info';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const EVENT = 'raadi:toast';

/** Shows a short message at the bottom of the console (from any client component). */
export function toast(message: string, tone: Tone = 'info'): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

const ICONS = { good: CircleCheck, bad: CircleAlert, info: Info } as const;

/** Renders toasts; announced politely to screen readers. Mounted once by the admin layout. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let next = 0;
    const onToast = (e: Event) => {
      const { message, tone } = (e as CustomEvent<Omit<Toast, 'id'>>).detail;
      const id = ++next;
      setToasts((list) => [...list.slice(-2), { id, message, tone }]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            data-testid="toast"
            className={cn(
              'pointer-events-auto flex max-w-md items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-float glass',
              t.tone === 'bad' && 'text-destructive',
            )}
          >
            <Icon
              aria-hidden
              className={cn('size-4 shrink-0', t.tone === 'good' && 'text-success')}
            />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
