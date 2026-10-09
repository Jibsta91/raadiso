import { Icon } from '../../components/icon';
import type { SavedSearch, SearchHit } from '@raadi/api-client';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListingFeature, ListingTile, TileSkeleton } from '../../components/listing-card';
import { Field, Glass, Status, Title } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { CATEGORIES, CATEGORY_ICONS } from '../../lib/categories';
import { unwrap, useApi, useLoad, usePullToRefresh } from '../../lib/api';
import { useAuth } from '../../lib/auth/context';
import { openSavedSearch } from '../../lib/saved';
import { clearRecent, readRecent, type Seen } from '../../lib/recent';
import { fonts, radius, space, tabBarSpace, useTheme } from '../../theme';

const PAGE_SIZE = 24;
const PAD = space.xl - 4;

/** A section's heading with an optional action on the right ("See all", "Clear"). */
function Section({
  title,
  action,
  onAction,
  testID,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  testID?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHead}>
        <Title>{title}</Title>
        {action && onAction ? (
          <Pressable
            role="button"
            testID={testID ? `${testID}-action` : undefined}
            hitSlop={8}
            onPress={onAction}
          >
            <Text style={[styles.action, { color: theme.accent }]}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A horizontal row of cards that runs to the screen's edges. */
function Rail({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      style={styles.bleed}
    >
      {children}
    </ScrollView>
  );
}

/** The categories as icon tiles, FINN's "markets" (ADR-0048). */
function CategoryTiles() {
  const { m } = useI18n();
  const theme = useTheme();
  return (
    <Rail>
      {CATEGORIES.map((id) => (
        <Pressable
          key={id}
          role="link"
          testID={`category-${id}`}
          aria-label={m.categories[id] ?? id}
          onPress={() => router.push({ pathname: '/categories/[id]', params: { id } })}
          style={styles.category}
        >
          <View
            style={[
              styles.categoryIcon,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Icon name={CATEGORY_ICONS[id] ?? 'pricetag-outline'} size={26} color={theme.text} />
          </View>
          <Text
            numberOfLines={2}
            maxFontSizeMultiplier={1.3}
            style={[styles.categoryText, { color: theme.text }]}
          >
            {m.categories[id] ?? id}
          </Text>
        </Pressable>
      ))}
    </Rail>
  );
}

/** Saved searches with new matches, newest news first: one tap shows them (and resets the count). */
function SavedNews({ searches }: { searches: SavedSearch[] }) {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  return (
    <Rail>
      {searches.map((s) => (
        <Pressable
          key={s.id}
          role="link"
          testID="home-saved-search"
          onPress={() => openSavedSearch(api, s)}
          style={[styles.saved, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Icon name="bookmark-outline" size={18} color={theme.accent} />
          <View style={styles.savedText}>
            <Text numberOfLines={1} style={[styles.savedName, { color: theme.text }]}>
              {s.name}
            </Text>
            <Text style={[styles.savedNew, { color: theme.accent }]}>
              {fill(m.savedSearches.new, { count: s.newCount })}
            </Text>
          </View>
        </Pressable>
      ))}
    </Rail>
  );
}

/** The newest listings, page by page as the user scrolls. */
function useLatest() {
  const api = useApi();
  const [items, setItems] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState<number>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.search
      .GET('/api/v1/search/listings', {
        params: { query: { sort: 'newest', page, pageSize: PAGE_SIZE } },
      })
      .then((res) => {
        const result = unwrap(res);
        if (cancelled || !result) return;
        setTotal(result.total);
        setItems((prev) => {
          if (page === 1) return result.items;
          // Listings published meanwhile shift the pages: never show one twice.
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...result.items.filter((x) => !seen.has(x.id))];
        });
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, page, nonce]);
  const more = () => {
    if (!loading && !error && total !== undefined && items.length < total) setPage((p) => p + 1);
  };
  const reload = useCallback(() => {
    setPage(1);
    setNonce((n) => n + 1);
  }, []);
  return { items, loading, error, more, reload };
}

export default function Home() {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const latest = useLatest();
  const promoted = latest.items.filter((hit) => hit.promoted).slice(0, 8);

  const reduced = useLoad(
    async () =>
      unwrap(
        await api.search.GET('/api/v1/search/listings', {
          params: { query: { priceDropped: 'true', sort: 'price_drop', pageSize: 10 } },
        }),
      )?.items ?? [],
    [api],
  );
  const saved = useLoad(
    async () =>
      auth.status === 'signedIn'
        ? (unwrap(await api.saved.GET('/api/v1/saved/searches'))?.items ?? [])
            .filter((s) => s.newCount > 0)
            .sort((a, b) => b.newCount - a.newCount)
        : [],
    [api, auth.status],
  );
  const [recent, setRecent] = useState<Seen[]>([]);

  // Back on the front page: what was just looked at, and what saved searches found meanwhile.
  const reloadSaved = saved.reload;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      void readRecent().then(setRecent);
      if (focused.current) reloadSaved();
      focused.current = true;
    }, [reloadSaved]),
  );

  const submit = () => {
    const query = q.trim();
    router.push(query ? { pathname: '/search', params: { q: query } } : '/search');
  };

  const reloadAll = () => {
    latest.reload();
    reduced.reload();
    saved.reload();
    void readRecent().then(setRecent);
  };
  const refresh = usePullToRefresh(latest.loading, reloadAll);

  // The search field scrolls with the page until it reaches the top, then stays pinned there on
  // glass while the listings scroll underneath (native driver: no JS work per frame).
  const scrollY = useRef(new Animated.Value(0)).current;
  const [wordmarkHeight, setWordmarkHeight] = useState(44);
  const [barHeight, setBarHeight] = useState(52);
  // Where the bar's content sits before scrolling, relative to its pinned place under the notch.
  const start = space.lg + wordmarkHeight + HEADER_GAP - BAR_PAD;
  const translateY = scrollY.interpolate({
    inputRange: [0, start],
    outputRange: [start, 0],
    extrapolateLeft: 'extend',
    extrapolateRight: 'clamp',
  });
  const pinned = scrollY.interpolate({
    inputRange: [start - 12, start],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const firstLoad = latest.loading && latest.items.length === 0;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Animated.FlatList
        testID="home-feed"
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + space.lg, paddingBottom: tabBarSpace + insets.bottom },
        ]}
        data={latest.items}
        numColumns={2}
        columnWrapperStyle={styles.row}
        keyExtractor={(hit) => hit.id}
        renderItem={({ item }) => <ListingTile hit={item} />}
        onEndReached={latest.more}
        onEndReachedThreshold={0.6}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        scrollIndicatorInsets={{ top: barHeight + BAR_PAD * 2 }}
        {...refresh}
        ListHeaderComponent={
          <View style={styles.header}>
            <View
              style={styles.top}
              onLayout={(e) => setWordmarkHeight(e.nativeEvent.layout.height)}
            >
              <Text role="heading" aria-level={1} style={[styles.wordmark, { color: theme.text }]}>
                raadiso<Text style={{ color: theme.accent }}>.</Text>
              </Text>
              <Pressable
                role="button"
                testID="new-listing"
                onPress={() => router.push('/listings/new')}
                style={[styles.sell, { backgroundColor: theme.ink }]}
              >
                <Icon name="add" size={18} color={theme.inkText} />
                <Text style={[styles.sellText, { color: theme.inkText }]}>{m.sell.cta}</Text>
              </Pressable>
            </View>
            {/* The pinned bar's place in the page. */}
            <View style={{ height: barHeight }} />
            <CategoryTiles />
            {saved.data?.length ? (
              <Section
                title={m.home.savedNew}
                testID="home-saved"
                action={m.home.seeAll}
                onAction={() => router.push('/saved-searches')}
              >
                <SavedNews searches={saved.data} />
              </Section>
            ) : null}
            {recent.length ? (
              <Section
                title={m.home.recent}
                testID="recently-viewed"
                action={m.home.clear}
                onAction={() => {
                  setRecent([]);
                  void clearRecent();
                }}
              >
                <Rail>
                  {recent.map((hit) => (
                    <View key={hit.id} style={styles.railTile}>
                      <ListingTile hit={hit} heart={false} />
                    </View>
                  ))}
                </Rail>
              </Section>
            ) : null}
            {promoted.length > 0 ? (
              <Section title={m.listing.promoted}>
                <Rail>
                  {promoted.map((hit) => (
                    <ListingFeature key={hit.id} hit={hit} />
                  ))}
                </Rail>
              </Section>
            ) : null}
            {reduced.data?.length ? (
              <Section
                title={m.home.reduced}
                testID="home-reduced"
                action={m.home.seeAll}
                onAction={() =>
                  router.push({
                    pathname: '/search',
                    params: { priceDropped: 'true', sort: 'price_drop' },
                  })
                }
              >
                <Rail>
                  {reduced.data.map((hit) => (
                    <View key={hit.id} style={styles.railTile}>
                      <ListingTile hit={hit} />
                    </View>
                  ))}
                </Rail>
              </Section>
            ) : null}
            <Title>{m.home.latest}</Title>
          </View>
        }
        ListEmptyComponent={
          firstLoad ? (
            <View style={styles.skeletons}>
              {[0, 1, 2].map((r) => (
                <View key={r} style={styles.row}>
                  <TileSkeleton />
                  <TileSkeleton />
                </View>
              ))}
            </View>
          ) : (
            <Status error={latest.error} onRetry={latest.reload} />
          )
        }
        ListFooterComponent={
          latest.loading && latest.items.length > 0 ? (
            <View style={styles.row}>
              <TileSkeleton />
              <TileSkeleton />
            </View>
          ) : null
        }
      />
      <Animated.View
        testID="home-pinned"
        style={[styles.bar, { paddingTop: insets.top + BAR_PAD, transform: [{ translateY }] }]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: pinned }]}>
          <Glass style={StyleSheet.absoluteFill}>
            <View />
          </Glass>
          <View style={[styles.hairline, { backgroundColor: theme.border }]} />
        </Animated.View>
        <View style={styles.barContent} onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}>
          <Field
            testID="home-search"
            inputMode="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            enablesReturnKeyAutomatically
            value={q}
            onChangeText={setQ}
            placeholder={m.home.searchPlaceholder}
            accessibilityLabel={m.search.placeholder}
            returnKeyType="search"
            onSubmitEditing={submit}
            icon={<Icon name="search" size={20} color={theme.muted} />}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const HEADER_GAP = space.lg + 2;
const BAR_PAD = space.sm;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: BAR_PAD },
  barContent: { paddingHorizontal: PAD },
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  list: { paddingHorizontal: PAD, flexGrow: 1 },
  row: { flexDirection: 'row', gap: space.md + 2, marginBottom: space.lg + 2 },
  skeletons: { gap: 0 },
  header: { gap: HEADER_GAP + 6, marginBottom: space.md },
  wordmark: { fontFamily: fonts.displayHeavy, fontSize: 40, lineHeight: 44, letterSpacing: -1.8 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: -6,
  },
  sell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 38,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
  },
  sellText: { fontFamily: fonts.semibold, fontSize: 15 },
  bleed: { marginHorizontal: -PAD },
  rail: { gap: space.md, paddingHorizontal: PAD },
  railTile: { width: 152 },
  section: { gap: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  action: { fontFamily: fonts.semibold, fontSize: 15 },
  category: { width: 76, alignItems: 'center', gap: 6 },
  categoryIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg - 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryText: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 16, textAlign: 'center' },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    minWidth: 180,
    maxWidth: 260,
    paddingHorizontal: space.md + 2,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  savedText: { flexShrink: 1, gap: 2 },
  savedName: { fontFamily: fonts.semibold, fontSize: 15 },
  savedNew: { fontFamily: fonts.semibold, fontSize: 13 },
});
