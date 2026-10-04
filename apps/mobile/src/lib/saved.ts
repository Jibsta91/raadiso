// Favourites and saved searches (ADR-0026), shared by the listing screen, lists and search.
import { useCallback, useEffect, useState } from 'react';
import { useApi } from './api';
import { useAuth } from './auth/context';
import { haptics } from './haptics';

/** Heart state for one listing: loads whether it is a favourite, toggles it optimistically. */
export function useFavourite(listingId: string | undefined) {
  const api = useApi();
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!listingId || auth.status !== 'signedIn') return setSaved(false);
    let cancelled = false;
    api.saved
      .GET('/api/v1/saved/favourites/ids')
      .then(({ data }) => !cancelled && setSaved(!!data?.ids.includes(listingId)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, auth.status, listingId]);

  const toggle = useCallback(async () => {
    if (!listingId || busy) return;
    if (auth.status !== 'signedIn') return void auth.signIn();
    const next = !saved;
    haptics.tap();
    setSaved(next);
    setBusy(true);
    const path = { params: { path: { listingId } } };
    const { response } = await (
      next
        ? api.saved.PUT('/api/v1/saved/favourites/{listingId}', path)
        : api.saved.DELETE('/api/v1/saved/favourites/{listingId}', path)
    ).catch(() => ({ response: { ok: false } }));
    if (!response.ok) setSaved(!next);
    setBusy(false);
  }, [api, auth, busy, listingId, saved]);

  return { saved, toggle };
}
