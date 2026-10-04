import { Icon } from '../../components/icon';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListingFeature, ListingTile } from '../../components/listing-card';
import { Chip, Field, Status, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { CATEGORIES } from '../../lib/categories';
import { unwrap, useApi, useLoad } from '../../lib/api';
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

  return (
    <FlatList
      contentContainerStyle={[
        styles.list,
        { paddingTop: insets.top + space.lg, paddingBottom: tabBarSpace + insets.bottom },
      ]}
      data={items}
      numColumns={2}
      columnWrapperStyle={styles.row}
      keyExtractor={(hit) => hit.id}
      renderItem={({ item }) => <ListingTile hit={item} />}
      onRefresh={latest.reload}
      refreshing={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.top}>
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
          <Field
            testID="home-search"
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
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xl - 4, flexGrow: 1 },
  row: { gap: space.md + 2, marginBottom: space.lg },
  header: { gap: space.lg + 2, marginBottom: space.md },
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
