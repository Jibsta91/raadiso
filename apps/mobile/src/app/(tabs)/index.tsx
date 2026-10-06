import { Icon } from '../../components/icon';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListingFeature, ListingTile } from '../../components/listing-card';
import { Chip, Field, Glass, Status, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { CATEGORIES } from '../../lib/categories';
import { unwrap, useApi, useLoad, usePullToRefresh } from '../../lib/api';
import { fonts, radius, space, tabBarSpace, useTheme } from '../../theme';

export default function Home() {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const latest = useLoad(
    async () =>
      unwrap(
        await api.search.GET('/api/v1/search/listings', {
          params: { query: { sort: 'newest', pageSize: 24 } },
        }),
      ),
    [api],
  );
  const items = latest.data?.items ?? [];
  const promoted = items.filter((hit) => hit.promoted);

  const submit = () => {
    const query = q.trim();
    router.push(query ? { pathname: '/search', params: { q: query } } : '/search');
  };

  const refresh = usePullToRefresh(latest.loading, latest.reload);

  // Search and categories scroll with the page until they reach the top, then stay pinned there
  // on glass while the listings scroll underneath (native driver: no JS work per frame).
  const scrollY = useRef(new Animated.Value(0)).current;
  const [wordmarkHeight, setWordmarkHeight] = useState(44);
  const [barHeight, setBarHeight] = useState(104);
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

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Animated.FlatList
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + space.lg, paddingBottom: tabBarSpace + insets.bottom },
        ]}
        data={items}
        numColumns={2}
        columnWrapperStyle={styles.row}
        keyExtractor={(hit) => hit.id}
        renderItem={({ item }) => <ListingTile hit={item} />}
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
            {promoted.length > 0 ? (
              <View style={styles.section}>
                <Title>{m.listing.promoted}</Title>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.carousel}
                  style={styles.bleed}
                >
                  {promoted.map((hit) => (
                    <ListingFeature key={hit.id} hit={hit} />
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <Title>{m.home.latest}</Title>
          </View>
        }
        ListEmptyComponent={
          <Status loading={latest.loading} error={latest.error} onRetry={latest.reload} />
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={styles.bleed}
          >
            {CATEGORIES.map((id) => (
              <Chip
                key={id}
                testID={`category-${id}`}
                label={m.categories[id]}
                onPress={() => router.push({ pathname: '/categories/[id]', params: { id } })}
              />
            ))}
          </ScrollView>
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
  barContent: { gap: space.md, paddingHorizontal: space.xl - 4 },
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  list: { paddingHorizontal: space.xl - 4, flexGrow: 1 },
  row: { gap: space.md + 2, marginBottom: space.lg },
  header: { gap: HEADER_GAP, marginBottom: space.md },
  wordmark: { fontFamily: fonts.displayHeavy, fontSize: 40, lineHeight: 44, letterSpacing: -1.8 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 38,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
  },
  sellText: { fontFamily: fonts.semibold, fontSize: 15 },
  bleed: { marginHorizontal: -(space.xl - 4) },
  chips: { gap: space.sm, paddingHorizontal: space.xl - 4 },
  section: { gap: space.md },
  carousel: { gap: space.md, paddingHorizontal: space.xl - 4 },
});
