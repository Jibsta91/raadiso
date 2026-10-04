import { Icon } from '../../components/icon';
import type { SavedSearch } from '@raadi/api-client';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Status } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { unwrap, useApi, useLoad, usePullToRefresh } from '../../lib/api';
import { SwipeRow } from '../../components/swipe-row';
import { useAuth } from '../../lib/auth/context';
import { fonts, radius, space, useTheme } from '../../theme';

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

function Row({ search, onDeleted }: { search: SavedSearch; onDeleted: () => void }) {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const [notify, setNotify] = useState(search.notify);

  const toggle = async (next: boolean) => {
    setNotify(next);
    const { response } = await api.saved
      .PATCH('/api/v1/saved/searches/{id}', {
        params: { path: { id: search.id } },
        body: { notify: next },
      })
      .catch(() => ({ response: { ok: false } }));
    if (!response.ok) setNotify(!next);
  };
  const remove = async () => {
    const { response } = await api.saved
      .DELETE('/api/v1/saved/searches/{id}', { params: { path: { id: search.id } } })
      .catch(() => ({ response: { ok: false } }));
    if (response.ok) onDeleted();
  };

  return (
    <SwipeRow
      actions={[
        {
          key: 'delete',
          label: m.swipe.delete,
          icon: 'trash-outline',
          color: theme.danger,
          onPress: () => void remove(),
        },
      ]}
    >
      <View
        style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
        accessible={false}
      >
        <Pressable
          role="link"
          testID="saved-search"
          style={styles.grow}
          onPress={() => openSavedSearch(api, search)}
        >
          <Text numberOfLines={2} style={[styles.name, { color: theme.text }]}>
            {search.name}
          </Text>
          {search.newCount > 0 ? (
            <Text style={[styles.new, { color: theme.accent }]}>
              {fill(m.savedSearches.new, { count: search.newCount })}
            </Text>
          ) : null}
        </Pressable>
        <Switch
          accessibilityLabel={m.savedSearches.alerts}
          value={notify}
          onValueChange={(next) => void toggle(next)}
          trackColor={{ true: theme.accent }}
        />
        <Pressable
          role="button"
          aria-label={m.savedSearches.delete}
          hitSlop={8}
          onPress={() => void remove()}
        >
          <Icon name="trash-outline" size={20} color={theme.muted} />
        </Pressable>
      </View>
    </SwipeRow>
  );
}

/** The signed-in user's saved searches (ADR-0026). */
export default function SavedSearches() {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const searches = useLoad(
    async () =>
      auth.status === 'signedIn'
        ? unwrap(await api.saved.GET('/api/v1/saved/searches'))?.items
        : undefined,
    [api, auth.status],
  );

  const refresh = usePullToRefresh(searches.loading, searches.reload);
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      {...refresh}
      testID="saved-searches"
      contentContainerStyle={styles.list}
      data={searches.data ?? []}
      keyExtractor={(s) => s.id}
      renderItem={({ item }) => <Row search={item} onDeleted={searches.reload} />}
      ListEmptyComponent={
        <Status
          loading={searches.loading}
          error={searches.error}
          empty={m.savedSearches.empty}
          onRetry={searches.reload}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm + 2, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md + 2,
    borderRadius: radius.lg - 2,
    borderWidth: 1,
  },
  grow: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 16 },
  new: { fontFamily: fonts.semibold, fontSize: 13 },
});
