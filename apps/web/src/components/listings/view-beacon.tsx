'use client';

import { useEffect } from 'react';

/**
 * Counts one view of a listing page per browser session (ADR-0045): a counter on the listing, nothing
 * about the viewer. Remembered in session storage; without it, every visit counts.
 */
export function ViewBeacon({ id }: { id: string }) {
  useEffect(() => {
    const key = `raadi.viewed.${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Blocked storage: count anyway.
    }
    void fetch(`/api/v1/listings/${id}/views`, { method: 'POST', keepalive: true }).catch(
      () => undefined,
    );
  }, [id]);
  return null;
}
