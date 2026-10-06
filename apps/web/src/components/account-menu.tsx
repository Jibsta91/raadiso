'use client';

import { ChevronDown, CircleUserRound } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The signed-in user's menu: a native <details> disclosure (works without JavaScript), closed on
 * Escape, on a click outside it, and after choosing an item.
 */
export function AccountMenu({
  name,
  label,
  children,
}: {
  name: string;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const close = () => details.removeAttribute('open');
    const onPointer = (e: PointerEvent) => {
      if (!details.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && details.open) {
        close();
        details.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border bg-card ps-1.5 pe-3 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <CircleUserRound aria-hidden className="size-8 text-subtle-foreground" strokeWidth={1.5} />
        <span className="sr-only">{label}: </span>
        <span data-testid="nav-account" className="sr-only max-w-40 truncate md:not-sr-only">
          {name}
        </span>
        <ChevronDown
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div
        className="glass absolute end-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-2xl p-2 shadow-float"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button[type="submit"]'))
            ref.current?.removeAttribute('open');
        }}
      >
        {children}
      </div>
    </details>
  );
}
