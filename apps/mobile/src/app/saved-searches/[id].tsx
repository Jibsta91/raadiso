import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Status } from '../../components/ui';
import { useI18n } from '../../i18n';
import { unwrap, useApi, useLoad } from '../../lib/api';
import { openSavedSearch } from '../../lib/saved';

/** Where a "new matches" push lands: opens that saved search's results. */
export default function OpenSavedSearch() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { m } = useI18n();
  const api = useApi();
  const searches = useLoad(
    async () => unwrap(await api.saved.GET('/api/v1/saved/searches'))?.items,
    [api],
  );
  const search = searches.data?.find((s) => s.id === id);

  useEffect(() => {
    if (search) openSavedSearch(api, search, true);
  }, [api, search]);

  if (searches.loading || search) return <Status loading />;
  return <Status error={searches.error} empty={m.savedSearches.gone} onRetry={searches.reload} />;
}
