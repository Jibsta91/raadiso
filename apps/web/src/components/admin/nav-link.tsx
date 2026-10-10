'use client';

import type { ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';

/** A sidebar link that shows when its section is open, with its count and shortcut. */
export function AdminNavLink({
  href,
  testId,
  children,
  count,
  hotkey,
}: {
  href: string;
  testId: string;
  children: ReactNode;
  count?: number;
  hotkey?: string;
}) {
  const pathname = usePathname();
  const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={`group flex shrink-0 items-center gap-2.5 rounded-card px-3 py-1.5 text-sm font-medium motion-safe:transition-colors focus-ring ${active ? 'bg-ink text-ink-foreground' : 'text-subtle-foreground hover:bg-accent hover:text-foreground'}`}
    >
      {children}
      {count ? (
        <span
          className={`ms-auto rounded-full px-1.5 text-xs font-semibold tabular-nums ${active ? 'bg-ink-foreground/20' : 'bg-destructive/12 text-destructive'}`}
          data-testid={`${testId}-count`}
        >
          {count}
        </span>
      ) : hotkey ? (
        <span className="ms-auto hidden font-mono text-xs text-muted-foreground opacity-0 motion-safe:transition-opacity group-hover:opacity-100 md:inline">
          g {hotkey}
        </span>
      ) : null}
    </Link>
  );
}
