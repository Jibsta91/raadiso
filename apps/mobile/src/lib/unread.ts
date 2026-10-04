import { useCallback, useEffect, useState } from 'react';
import { useApi } from './api';
import { useAuth } from './auth/context';
import { useRealtime } from './realtime';

/** Unread messages for the tab badge: loaded on sign-in and after every live message event. */
export function useUnread(): number {
  const api = useApi();
  const { status } = useAuth();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    if (status !== 'signedIn') return setCount(0);
    api.messaging
      .GET('/api/v1/messaging/unread')
      .then(({ data }) => setCount(data?.count ?? 0))
      .catch(() => undefined);
  }, [api, status]);
  useEffect(load, [load]);
  useRealtime((event) => event.type !== 'hello' && load());
  return count;
}
