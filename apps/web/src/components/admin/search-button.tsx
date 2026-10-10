'use client';

import { Search } from 'lucide-react';
import { openPalette } from './command-palette';

/** The sidebar's search field look-alike: opens the command palette. */
export function SearchButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={openPalette}
      className="flex h-9 w-full items-center gap-2 rounded-card border bg-background px-3 text-sm text-muted-foreground hover:bg-accent"
      data-testid="open-palette"
    >
      <Search aria-hidden className="size-4" />
      <span className="flex-1 text-start">{label}</span>
      <kbd className="rounded border bg-card px-1 font-mono text-xs">⌘K</kbd>
    </button>
  );
}
