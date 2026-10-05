import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
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

const notificationListeners = new Set<() => void>();

/** Tells the notifications badge to reload now (after reading notifications). */
export function refreshNotificationBadge(): void {
  for (const listener of notificationListeners) listener();
}

/**
 * Unread in-app notifications for the tab badge: loaded on sign-in, every minute, when the app
 * comes back to the foreground, and right after notifications are read.
 */
export function useUnreadNotifications(): number {
  const api = useApi();
  const { status } = useAuth();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    if (status !== 'signedIn') return setCount(0);
    api.notifications
      .GET('/api/v1/notifications/unread')
      .then(({ data }) => setCount(data?.count ?? 0))
      .catch(() => undefined);
  }, [api, status]);
  useEffect(() => {
    load();
    notificationListeners.add(load);
    const timer = setInterval(load, 60_000);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && load());
    return () => {
      notificationListeners.delete(load);
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);
  return count;
}
