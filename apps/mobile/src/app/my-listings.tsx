import type { Listing } from '@raadi/api-client';
import { priceUnitOf } from '@raadi/catalog/categories';
import { Image } from 'expo-image';
import { Link, router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/icon';
import { NoPhoto } from '../components/no-photo';
import { Segmented } from '../components/segmented';
import { SwipeRow } from '../components/swipe-row';
import { Badge, Status } from '../components/ui';
import { fill, useI18n } from '../i18n';
import { unwrap, useApi, usePaged, usePullToRefresh } from '../lib/api';
import { useAuth } from '../lib/auth/context';
import { config } from '../lib/config';
import { confirm } from '../lib/confirm';
import { formatPrice, intlLocale } from '../lib/format';
import { absoluteUrl } from '../lib/urls';
import { fonts, radius, space, useTheme } from '../theme';

const PAGE_SIZE = 50;

type Filter = 'all' | 'active' | 'finished';

/** Sold, or rented for rentals and stays (the categories whose price is per month or night). */
function finishedLabel(listing: Listing, m: ReturnType<typeof useI18n>['m']): string {
  const rental = priceUnitOf(listing.category as never, listing.subcategory as never) !== undefined;
  return rental ? m.myListings.rented : m.myListings.sold;
}

function Row({ listing, onChanged }: { listing: Listing; onChanged: () => void }) {
  const { m, locale } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const image = listing.images[0];
  const path = { params: { path: { id: listing.id } } };
  // Renew (ADR-0045): once a week, so offered only when it can be done.
  const renewable =
    listing.status === 'active' &&
    !!listing.stats &&
    Date.parse(listing.stats.renewableAt) <= Date.now();
  const renew = () =>
    void api.listings.POST('/api/v1/listings/{id}/renew', path).then(onChanged, () => undefined);
  const markSold = () =>
    void api.listings
      .PATCH('/api/v1/listings/{id}', { ...path, body: { status: 'sold' } })
      .then(onChanged, () => undefined);
  const remove = async () => {
    const sure = await confirm(
      m.swipe.deleteTitle,
      m.swipe.deleteBody,
      m.swipe.delete,
      m.swipe.cancel,
    );
    if (!sure) return;
    await api.listings.DELETE('/api/v1/listings/{id}', path).catch(() => undefined);
    onChanged();
  };
  const finished = listing.status === 'sold' ? finishedLabel(listing, m) : undefined;
  const subcategory =
    m.taxonomy.subcategories[listing.subcategory] ?? m.categories[listing.category];
  const price = formatPrice(listing.price, locale, m.common.noPrice);
  const changed = fill(m.myListings.changed, {
    date: new Date(listing.updatedAt).toLocaleDateString(intlLocale[locale]),
  });
  return (
    <SwipeRow
      actions={[
        ...(listing.status === 'active'
          ? [
              {
                key: 'edit',
                label: m.sell.edit,
                icon: 'create-outline' as const,
                // Slate in both themes: the label on it is white.
                color: '#5b6170',
                onPress: () => router.push(`/listings/edit/${listing.id}`),
              },
              {
                key: 'sold',
                label: m.swipe.markSold,
                icon: 'pricetag-outline' as const,
                color: theme.accent,
                onPress: markSold,
              },
              ...(renewable
                ? [
                    {
                      key: 'renew',
                      label: m.market.renew,
                      icon: 'refresh-outline' as const,
                      color: '#2f7d4f',
                      onPress: renew,
                    },
                  ]
                : []),
            ]
          : []),
        {
          key: 'delete',
          label: m.swipe.delete,
          icon: 'trash-outline',
          color: theme.danger,
          onPress: () => void remove(),
        },
      ]}
    >
      <Link href={`/listings/${listing.id}`} asChild>
        {/* Link asChild merges props by spreading: a style array would reach the DOM as {0: …}. */}
        <Pressable
          testID="my-listing"
          role="link"
          aria-label={[listing.title, subcategory, price, finished, changed]
            .filter(Boolean)
            .join(', ')}
          style={{ ...styles.row, borderColor: theme.border }}
        >
          {image ? (
            <Image
              source={{ uri: absoluteUrl(image.urls.thumb, config.apiBaseUrl) }}
              // expo-image hands styles to the DOM on the web: pass one object, not an array.
              style={{ ...styles.thumb, backgroundColor: theme.placeholder }}
            />
          ) : (
            <NoPhoto category={listing.category} size={28} style={styles.thumb} />
          )}
          <View style={styles.text}>
            <View style={styles.titleRow}>
              <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>
                {listing.title}
              </Text>
              {finished ? (
                <Badge label={finished} tone="neutral" testID="my-listing-status" />
              ) : null}
            </View>
            <Text numberOfLines={1} style={[styles.meta, { color: theme.muted }]}>
              {subcategory} · {price}
            </Text>
            <View style={styles.statsRow}>
              {listing.stats ? (
                <View
                  style={styles.stat}
                  testID="my-listing-views"
                  aria-label={fill(m.myListings.views, { count: listing.stats.views })}
                >
                  <Icon name="eye-outline" size={15} color={theme.muted} />
                  <Text style={[styles.statText, { color: theme.text }]}>
                    {listing.stats.views}
                  </Text>
                </View>
              ) : null}
              {listing.stats?.favourites !== undefined ? (
                <View
                  style={styles.stat}
                  testID="my-listing-favourites"
                  aria-label={fill(m.myListings.favourites, { count: listing.stats.favourites })}
                >
                  <Icon name="heart-outline" size={15} color={theme.muted} />
                  <Text style={[styles.statText, { color: theme.text }]}>
                    {listing.stats.favourites}
                  </Text>
                </View>
              ) : null}
              <Text style={[styles.changed, { color: theme.muted }]}>{changed}</Text>
            </View>
          </View>
        </Pressable>
      </Link>
    </SwipeRow>
  );
}

/** The signed-in user's listings: filter, search, status and statistics; swipe to edit or finish. */
export default function MyListings() {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const mine = usePaged(
    async (offset) =>
      auth.status === 'signedIn'
        ? unwrap(
            await api.listings.GET('/api/v1/listings/mine', {
              params: { query: { limit: PAGE_SIZE, offset } },
            }),
          )
        : undefined,
    [api, auth.status],
  );

  const counts = useMemo(
    () => ({
      all: mine.items.length,
      active: mine.items.filter((l) => l.status === 'active').length,
      finished: mine.items.filter((l) => l.status === 'sold').length,
    }),
    [mine.items],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return mine.items.filter(
      (l) =>
        (filter === 'all' || (filter === 'active' ? l.status === 'active' : l.status === 'sold')) &&
        (!needle || l.title.toLocaleLowerCase().includes(needle)),
    );
  }, [mine.items, filter, query]);

  const refresh = usePullToRefresh(mine.loading, mine.reload);
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              role="button"
              aria-label={m.myListings.searchOpen}
              hitSlop={10}
              testID="my-listings-search-toggle"
              onPress={() => {
                setSearching((open) => !open);
                setQuery('');
              }}
            >
              <Icon name="search" size={22} color={theme.text} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        {...refresh}
        contentContainerStyle={styles.list}
        data={shown}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => <Row listing={item} onChanged={mine.reload} />}
        onEndReached={mine.more}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          mine.items.length ? (
            <View style={styles.header}>
              {searching ? (
                <TextInput
                  autoFocus
                  value={query}
                  onChangeText={setQuery}
                  placeholder={m.myListings.search}
                  placeholderTextColor={theme.muted}
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                  testID="my-listings-search"
                  style={[
                    styles.search,
                    {
                      color: theme.text,
                      backgroundColor: theme.surface,
                      borderColor: theme.border,
                    },
                  ]}
                />
              ) : null}
              <Segmented
                testID="my-listings-filter"
                label={m.account.myListings}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: `${m.myListings.all} (${counts.all})` },
                  { value: 'active', label: `${m.myListings.active} (${counts.active})` },
                  { value: 'finished', label: `${m.myListings.finished} (${counts.finished})` },
                ]}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Status
            loading={mine.loading && mine.items.length === 0}
            error={mine.error}
            empty={mine.items.length ? m.myListings.noMatch : m.account.myListingsEmpty}
            onRetry={mine.reload}
          />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingBottom: space.lg, flexGrow: 1 },
  header: { gap: space.md, paddingTop: space.sm, paddingBottom: space.md },
  search: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    fontFamily: fonts.medium,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 88, height: 88, borderRadius: radius.md },
  text: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.medium, fontSize: 14, fontVariant: ['tabular-nums'] },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 'auto' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  changed: { marginLeft: 'auto', fontFamily: fonts.body, fontSize: 13 },
});
