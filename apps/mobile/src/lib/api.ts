import {
  createListingsClient,
  createMessagingClient,
  createNotificationsClient,
  createSavedClient,
  createSearchClient,
  createTrustClient,
} from '@raadi/api-client';
import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList } from 'react';
import { useAuth } from './auth/context';
import { config } from './config';
import { APP_COUNTRY } from './country';

/** Every search and suggestion is in the app's country (ADR-0040), unless it names one. */
function inCountry<C extends ReturnType<typeof createSearchClient>>(client: C): C {
  client.use({
    onRequest({ request }) {
      const url = new URL(request.url);
      if (url.searchParams.has('country')) return undefined;
      url.searchParams.set('country', APP_COUNTRY);
      return new Request(url, request);
    },
  });
  return client;
}

/** Typed clients for the services the app uses, authenticated by the platform's auth provider. */
export function useApi() {
  const auth = useAuth();
  return useMemo(() => {
    const options = { baseUrl: config.apiBaseUrl, fetch: auth.fetch };
    return {
      listings: createListingsClient(options),
      search: inCountry(createSearchClient(options)),
      messaging: createMessagingClient(options),
      notifications: createNotificationsClient(options),
      saved: createSavedClient(options),
      trust: createTrustClient(options),
    };
  }, [auth.fetch]);
}

export interface Loaded<T> {
  data: T | undefined;
  error: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `load` when `deps` change and keeps the latest result. `undefined` from `load` means
 * "not found" (data stays undefined, no error); a thrown error or rejected promise sets `error`.
 */
export function useLoad<T>(load: () => Promise<T | undefined>, deps: DependencyList): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    latest
      .current()
      .then((value) => !cancelled && setData(value))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // The dependency list is the caller's, like useEffect's own; ESLint checks it at each call
    // site instead (additionalHooks in eslint.config.js).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** One page of an offset-paginated list, as the services return it. */
export interface Page<T> {
  items: T[];
  total: number;
}

export interface Paged<T> {
  items: T[];
  error: boolean;
  loading: boolean;
  reload: () => void;
  /** Loads the next page, if there is one (wire to FlatList's onEndReached). */
  more: () => void;
}

/** Like `useLoad` for offset-paginated lists: `reload` starts again at the first page. */
export function usePaged<T>(
  load: (offset: number) => Promise<Page<T> | undefined>,
  deps: DependencyList,
): Paged<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState<number>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(load);
  latest.current = load;

  // New inputs start again at the first page.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's list (checked at call sites)
  useEffect(() => setOffset(0), deps);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    latest
      .current(offset)
      .then((page) => {
        if (cancelled) return;
        setTotal(page?.total ?? 0);
        setItems((prev) =>
          offset === 0 ? (page?.items ?? []) : [...prev, ...(page?.items ?? [])],
        );
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // The dependency list is the caller's, like useEffect's own (checked at call sites).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, offset, nonce]);

  const reload = useCallback(() => {
    setOffset(0);
    setNonce((n) => n + 1);
  }, []);
  const more = useCallback(() => {
    if (!loading && total !== undefined && items.length < total) setOffset(items.length);
  }, [loading, total, items.length]);
  return { items, error, loading, reload, more };
}

/** Throws for transport and server errors so `useLoad` reports them; 404 becomes undefined. */
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T | undefined {
  if (result.response.status === 404) return undefined;
  if (result.error !== undefined || result.data === undefined) {
    throw new Error(`HTTP ${result.response.status}`);
  }
  return result.data;
}

/**
 * Pull to refresh for a list: the spinner shows from the pull until the reload has finished (iOS and
 * Android keep it visible), never on the first load or on later pages.
 */
export function usePullToRefresh(loading: boolean, reload: () => void) {
  const [pulled, setPulled] = useState(false);
  useEffect(() => {
    if (pulled && !loading) setPulled(false);
  }, [pulled, loading]);
  const onRefresh = useCallback(() => {
    setPulled(true);
    reload();
  }, [reload]);
  return { refreshing: pulled && loading, onRefresh };
}
