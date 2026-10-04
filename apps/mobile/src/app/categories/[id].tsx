import { Icon } from '../../components/icon';
import type { FacetValue } from '@raadi/api-client';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Body, Button, LargeTitle, Status, Title } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { unwrap, useApi } from '../../lib/api';
import {
  CATEGORY_ICONS,
  isCategory,
  SUBCATEGORY_ICONS,
  subcategoriesOf,
  type CategoryId,
} from '../../lib/categories';
import { fonts, radius, space, useTheme } from '../../theme';

/** A category's front page: one tile per subcategory with its listing count, like FINN. */
export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { m } = useI18n();
  if (!isCategory(id)) return <Status error onRetry={() => router.replace('/')} />;
  return (
    <>
      <Stack.Screen options={{ title: m.categories[id] }} />
      <Category id={id} />
    </>
  );
}

function Category({ id }: { id: CategoryId }) {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const [counts, setCounts] = useState<Map<string, number>>();
  const [total, setTotal] = useState<number>();
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api.search
      .GET('/api/v1/search/listings', { params: { query: { category: id, pageSize: 1 } } })
      .then((res) => {
        const result = unwrap(res);
        if (cancelled || !result) return;
        setTotal(result.total);
        setCounts(new Map(result.facets.subcategory.map((f: FacetValue) => [f.value, f.count])));
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [api, id, nonce]);

  return (
    <ScrollView contentContainerStyle={styles.page} testID="category-screen">
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: theme.ink }]}>
          <Icon name={CATEGORY_ICONS[id]} size={30} color={theme.inkText} aria-hidden />
        </View>
        <LargeTitle>{m.categories[id]}</LargeTitle>
        {total !== undefined ? (
          <Body muted testID="category-total">
            {fill(m.category.listings, { count: total })}
          </Body>
        ) : null}
      </View>
      <Title>{m.category.subcategories}</Title>
      {error ? <Status error onRetry={() => setNonce((n) => n + 1)} /> : null}
      <View style={styles.grid}>
        {subcategoriesOf(id).map((sub) => {
          const count = counts?.get(sub);
          return (
            <Pressable
              key={sub}
              role="link"
              testID={`subcategory-${sub}`}
              onPress={() =>
                router.push({ pathname: '/search', params: { category: id, subcategory: sub } })
              }
              style={({ pressed }) => [
                styles.tile,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <View style={[styles.tileIcon, { backgroundColor: theme.surfaceAlt }]}>
                <Icon name={SUBCATEGORY_ICONS[sub]} size={22} color={theme.text} aria-hidden />
              </View>
              <Text numberOfLines={2} style={[styles.tileName, { color: theme.text }]}>
                {m.taxonomy.subcategories[sub]}
              </Text>
              {count !== undefined ? (
                <Text style={[styles.tileCount, { color: theme.muted }]}>
                  {fill(m.category.listings, { count })}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Button
        testID="category-see-all"
        variant="ink"
        label={total !== undefined ? fill(m.category.seeAll, { count: total }) : m.search.submit}
        onPress={() => router.push({ pathname: '/search', params: { category: id } })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xl - 4, gap: space.lg, paddingBottom: space.xxl * 2 },
  hero: { gap: space.sm, marginBottom: space.sm },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 132,
  },
  tileIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19 },
  tileCount: { fontFamily: fonts.medium, fontSize: 13 },
});
