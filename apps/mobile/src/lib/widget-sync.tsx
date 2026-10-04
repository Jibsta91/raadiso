import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useI18n } from '../i18n';
import { unwrap, useApi } from './api';
import { useAuth } from './auth/context';
import { updateWidget } from './widget';

/**
 * Keeps the home screen widget current: on start, on sign-in or -out and whenever the app comes back
 * to the foreground, it writes the saved searches and their new matches for the widget.
 */
export function WidgetSync(): null {
  const auth = useAuth();
  const api = useApi();
  const { m } = useI18n();

  useEffect(() => {
    if (auth.status === 'loading') return;
    const base = {
      title: m.savedSearches.title,
      empty: m.widget.empty,
      signedOutText: m.widget.signedOut,
    };
    const sync = () => {
      if (auth.status !== 'signedIn') {
        return updateWidget({ ...base, signedOut: true, total: 0, items: [] });
      }
      api.saved
        .GET('/api/v1/saved/searches')
        .then((res) => {
          const searches = unwrap(res)?.items;
          if (!searches) return;
          const items = searches
            .map((s) => ({ id: s.id, name: s.name, count: s.newCount }))
            .sort((a, b) => b.count - a.count);
          updateWidget({
            ...base,
            signedOut: false,
            total: items.reduce((sum, item) => sum + item.count, 0),
            items,
          });
        })
        .catch(() => undefined);
    };
    sync();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => subscription.remove();
  }, [auth.status, api, m]);

  return null;
}
