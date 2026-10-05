'use client';

import { useEffect } from 'react';
import { rememberRecent } from './command-palette';

/** Adds the page's object to ⌘K's "recently viewed" (this browser only). */
export function TrackRecent(props: {
  kind: 'user' | 'listing' | 'order';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}) {
  const { kind, id, title, subtitle, href } = props;
  useEffect(
    () => rememberRecent({ kind, id, title, subtitle, href }),
    [kind, id, title, subtitle, href],
  );
  return null;
}
