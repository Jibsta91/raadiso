import type { SavedSearch } from '@raadi/api-client';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/icon';
import { SwipeRow } from '../../components/swipe-row';
import { Status } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { unwrap, useApi, useLoad, usePullToRefresh } from '../../lib/api';
import { useAuth } from '../../lib/auth/context';
import { openSavedSearch } from '../../lib/saved';
import { fonts, radius, space, useTheme } from '../../theme';

type Sort = 'newest' | 'name';

/** The category a saved search was made in, or '' for searches across all categories. */
function categoryOf(search: SavedSearch): string {
  const category = (search.params as Record<string, unknown>).category;
  return typeof category === 'string' ? category : '';
}

function Row({ search, onChanged }: { search: SavedSearch; onChanged: () => void }) {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const [notify, setNotify] = useState(search.notify);
  const [menuOpen, setMenuOpen] = useState(false);

  const toggle = async () => {
    const next = !notify;
    setNotify(next);
    setMenuOpen(false);
    const { response } = await api.saved
      .PATCH('/api/v1/saved/searches/{id}', {
        params: { path: { id: search.id } },
        body: { notify: next },
      })
      .catch(() => ({ response: { ok: false } }));
    if (!response.ok) setNotify(!next);
  };
  const remove = async () => {
    setMenuOpen(false);
    const { response } = await api.saved
      .DELETE('/api/v1/saved/searches/{id}', { params: { path: { id: search.id } } })
      .catch(() => ({ response: { ok: false } }));
    if (response.ok) onChanged();
  };
  // The "…" menu: the system action sheet on iOS, a small panel under the row elsewhere.
  const openMenu = () => {
    if (Platform.OS !== 'ios') return setMenuOpen((open) => !open);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: search.name,
        options: [
          notify ? m.savedSearches.turnOff : m.savedSearches.turnOn,
          m.savedSearches.delete,
          m.savedSearches.cancel,
        ],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) void toggle();
        if (index === 1) void remove();
      },
    );
  };

  return (
    <View>
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
        <View style={[styles.row, { backgroundColor: theme.surface }]}>
          <Pressable
            role="link"
            testID="saved-search"
            style={styles.grow}
            onPress={() => openSavedSearch(api, search)}
          >
            <Text numberOfLines={2} style={[styles.name, { color: theme.text }]}>
              {search.name}
            </Text>
            <Text testID="saved-search-alerts" style={[styles.sub, { color: theme.muted }]}>
              {notify ? m.savedSearches.alertsOn : m.savedSearches.alertsOff}
            </Text>
            {search.newCount > 0 ? (
              <Text style={[styles.new, { color: theme.accent }]}>
                {fill(m.savedSearches.new, { count: search.newCount })}
              </Text>
            ) : null}
          </Pressable>
          <Pressable
            role="button"
            testID="saved-search-menu"
            aria-label={fill(m.savedSearches.more, { name: search.name })}
            hitSlop={10}
            onPress={openMenu}
          >
            <Icon name="ellipsis-horizontal" size={22} color={theme.muted} />
          </Pressable>
        </View>
      </SwipeRow>
      {menuOpen ? (
        <View style={[styles.menu, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Pressable role="button" testID="saved-search-toggle" onPress={() => void toggle()}>
            <Text style={[styles.menuItem, { color: theme.text }]}>
              {notify ? m.savedSearches.turnOff : m.savedSearches.turnOn}
            </Text>
          </Pressable>
          <Pressable role="button" testID="saved-search-delete" onPress={() => void remove()}>
            <Text style={[styles.menuItem, { color: theme.danger }]}>{m.savedSearches.delete}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** The signed-in user's saved searches (ADR-0026), grouped by category, with their alert status. */
export default function SavedSearches() {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const [sort, setSort] = useState<Sort>('newest');
  const searches = useLoad(
    async () =>
      auth.status === 'signedIn'
        ? unwrap(await api.saved.GET('/api/v1/saved/searches'))?.items
        : undefined,
    [api, auth.status],
  );

  const sections = useMemo(() => {
    const items = [...(searches.data ?? [])].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt),
    );
    const groups = new Map<string, SavedSearch[]>();
    for (const search of items) {
      const key = categoryOf(search);
      groups.set(key, [...(groups.get(key) ?? []), search]);
    }
    return [...groups.entries()].map(([category, data]) => ({
      title: category ? (m.categories[category] ?? category) : m.savedSearches.allCategories,
      data,
    }));
  }, [searches.data, sort, m]);

  const refresh = usePullToRefresh(searches.loading, searches.reload);
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            searches.data?.length ? (
              <Pressable
                role="button"
                testID="saved-searches-sort"
                hitSlop={10}
                onPress={() => setSort((s) => (s === 'newest' ? 'name' : 'newest'))}
              >
                <Text style={[styles.sort, { color: theme.accent }]}>
                  {sort === 'newest' ? m.savedSearches.sortNewest : m.savedSearches.sortName}
                </Text>
              </Pressable>
            ) : null,
        }}
      />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        {...refresh}
        testID="saved-searches"
        contentContainerStyle={styles.list}
        sections={sections}
        keyExtractor={(s) => s.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: theme.muted }]}>
            {section.title.toLocaleUpperCase()}
          </Text>
        )}
        renderItem={({ item }) => <Row search={item} onChanged={searches.reload} />}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListEmptyComponent={
          <Status
            loading={searches.loading}
            error={searches.error}
            empty={m.savedSearches.empty}
            onRetry={searches.reload}
          />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, flexGrow: 1 },
  section: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    letterSpacing: 0.4,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  gap: { height: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  grow: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.semibold, fontSize: 17 },
  sub: { fontFamily: fonts.body, fontSize: 14 },
  new: { fontFamily: fonts.semibold, fontSize: 13 },
  menu: {
    marginTop: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
  },
  menuItem: { fontFamily: fonts.medium, fontSize: 16, paddingVertical: space.md },
  sort: { fontFamily: fonts.semibold, fontSize: 16 },
});
