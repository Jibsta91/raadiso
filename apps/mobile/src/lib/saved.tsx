// Favourites and saved searches (ADR-0026), shared by the listing screen, lists and search.
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SavedSearch } from '@raadi/api-client';
import { router } from 'expo-router';
import { useApi } from './api';
import { useAuth } from './auth/context';
import { haptics } from './haptics';

interface FavouritesState {
  /** The signed-in user's favourite listing ids (empty when signed out). */
  ids: ReadonlySet<string>;
  /** Adds or removes one, optimistically; signed-out users are asked to sign in. */
  toggle: (listingId: string) => Promise<void>;
  /** Fetches the ids again, e.g. after the favourites list changed them. */
  refresh: () => void;
}

const FavouritesContext = createContext<FavouritesState | null>(null);

/**
 * One copy of the favourite ids for the whole app (ADR-0048): every card's heart reads it, so a grid
 * of 24 listings costs one request, and a heart changed on one screen is right on every other.
 */
export function FavouritesProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const auth = useAuth();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const [nonce, setNonce] = useState(0);
  const busy = useRef(new Set<string>());

  useEffect(() => {
    if (auth.status !== 'signedIn') return setIds(new Set());
    let cancelled = false;
    api.saved
      .GET('/api/v1/saved/favourites/ids')
      .then(({ data }) => !cancelled && data && setIds(new Set(data.ids)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, auth.status, nonce]);

  const flip = useCallback(
    (id: string, on: boolean) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );

  const toggle = useCallback(
    async (listingId: string) => {
      if (busy.current.has(listingId)) return;
      if (auth.status !== 'signedIn') return void auth.signIn();
      const next = !ids.has(listingId);
      haptics.tap();
      flip(listingId, next);
      busy.current.add(listingId);
      const path = { params: { path: { listingId } } };
      const { response } = await (
        next
          ? api.saved.PUT('/api/v1/saved/favourites/{listingId}', path)
          : api.saved.DELETE('/api/v1/saved/favourites/{listingId}', path)
      ).catch(() => ({ response: { ok: false } }));
      if (!response.ok) flip(listingId, !next);
      busy.current.delete(listingId);
    },
    [api, auth, flip, ids],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const value = useMemo(() => ({ ids, toggle, refresh }), [ids, toggle, refresh]);
  return <FavouritesContext value={value}>{children}</FavouritesContext>;
}

export function useFavourites(): FavouritesState {
  const ctx = use(FavouritesContext);
  if (!ctx) throw new Error('useFavourites outside FavouritesProvider');
  return ctx;
}

/** Heart state for one listing: whether it is a favourite, and a toggle. */
export function useFavourite(listingId: string | undefined) {
  const { ids, toggle } = useFavourites();
  const saved = !!listingId && ids.has(listingId);
  const flip = useCallback(
    async () => (listingId ? toggle(listingId) : undefined),
    [listingId, toggle],
  );
  return { saved, toggle: flip };
}

/** Opens a saved search: resets its "new" count and shows the results. */
export function openSavedSearch(
  api: ReturnType<typeof useApi>,
  search: Pick<SavedSearch, 'id' | 'params'>,
  replace = false,
) {
  void api.saved
    .POST('/api/v1/saved/searches/{id}/seen', { params: { path: { id: search.id } } })
    .catch(() => undefined);
  const target = { pathname: '/search' as const, params: search.params };
  if (replace) router.replace(target);
  else router.push(target);
}
