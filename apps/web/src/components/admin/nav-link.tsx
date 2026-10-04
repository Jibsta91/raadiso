'use client';

import type { ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';

/** A sidebar link that shows when its section is open. */
export function AdminNavLink({
  href,
  testId,
  children,
}: {
  href: string;
  testId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-ink text-ink-foreground' : 'hover:bg-accent'}`}
    >
      {children}
    </Link>
  );
}
