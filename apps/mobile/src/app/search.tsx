import { Icon } from '../components/icon';
import type { Autocomplete, FacetValue, SearchHit } from '@raadi/api-client';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListingTile } from '../components/listing-card';
import { filterKeys, SearchFilters } from '../components/search-filters';
import { Body, Chip, Field, Status } from '../components/ui';
import { SortMenu } from '../components/sort-menu';
import { fill, useI18n } from '../i18n';
import { unwrap, useApi } from '../lib/api';
import { type Sort, sortsFor } from '../lib/sort';
import { CATEGORIES, isCategory, isSubcategoryOf, subcategoriesOf } from '../lib/categories';
import { useAuth } from '../lib/auth/context';
import { fonts, radius, space, useTheme } from '../theme';

const PAGE_SIZE = 24;

/** "Save search" (ADR-0026): saved at once; signed-out users are asked to sign in first. */
function SaveSearch({ params, name }: { params: Record<string, string>; name: string }) {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const key = JSON.stringify(params);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => setState('idle'), [key]);

  const save = async () => {
    if (auth.status !== 'signedIn') return void auth.signIn();
    setState('saving');
    const { response } = await api.saved
      .POST('/api/v1/saved/searches', { body: { name, params, notify: true } })
      .catch(() => ({ response: { ok: false } }));
    setState(response.ok ? 'saved' : 'idle');
  };

  return (
    <Pressable
      role="button"
      testID="save-search"
      disabled={state !== 'idle'}
      onPress={() => void save()}
      style={[styles.save, { borderColor: theme.border, backgroundColor: theme.surface }]}
    >
      <Icon
        name={state === 'saved' ? 'bookmark' : 'bookmark-outline'}
        size={16}
        color={theme.text}
      />
      <Text style={[styles.saveText, { color: theme.text }]}>
        {state === 'saved' ? m.savedSearches.saved : m.savedSearches.save}
      </Text>
    </Pressable>
  );
}

export default function Search() {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const query = one(params.q) ?? '';
  const rawCategory = one(params.category);
  const category = isCategory(rawCategory) ? rawCategory : undefined;
  const rawSubcategory = one(params.subcategory);
  const subcategory = isSubcategoryOf(category, rawSubcategory) ? rawSubcategory : undefined;
  // Other filters (from a saved search made on the website: fuel, yearMin, …) pass straight through.
  const extra = Object.fromEntries(
    Object.entries(params)
      .filter(([k]) => !['q', 'category', 'subcategory', 'page', 'pageSize', 'asked'].includes(k))
      .map(([k, v]) => [k, one(v) ?? ''])
      .filter(([, v]) => v !== ''),
  );
  const extraKey = JSON.stringify(extra);
  const rawSort = one(params.sort);
  const sorts = sortsFor(category, subcategory);
  const sort: Sort = rawSort && sorts.includes(rawSort) ? rawSort : 'relevance';
  // What the query was before search read it (ADR-0041), to offer the exact words instead.
  const asked = one(params.asked);
  const understandOff = one(params.understand) === 'false';
  const reduced = extra.priceDropped === 'true';
  const [text, setText] = useState(query);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState<number>();
  const [makes, setMakes] = useState<FacetValue[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [relaxed, setRelaxed] = useState(false);
  const [suggestion, setSuggestion] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Autocomplete | null>(null);

  // Suggestions while typing (ADR-0041), debounced; an older answer never replaces a newer one.
  useEffect(() => {
    const q = text.trim();
    if (!focused || !q || q === query) {
      setSuggestions(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search
        .GET('/api/v1/search/autocomplete', { params: { query: { q: q.slice(0, 60) } } })
        .then((res) => !cancelled && setSuggestions(unwrap(res) ?? null))
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, text, query, focused]);

  useEffect(() => setText(query), [query]);

  // A new query or filter starts again at page 1.
  useEffect(() => {
    setHits([]);
    setTotal(undefined);
    setPage(1);
  }, [query, category, subcategory, extraKey, nonce]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.search
      .GET('/api/v1/search/listings', {
        params: {
          query: {
            ...JSON.parse(extraKey),
            q: query || undefined,
            category,
            subcategory,
            page,
            pageSize: PAGE_SIZE,
          },
        },
      })
      .then((res) => {
        const result = unwrap(res);
        if (cancelled || !result) return;
        // What the query said becomes the screen's own filters, read once (understand=false after).
        if (result.query.understood.length && !understandOff) {
          router.setParams({
            ...Object.assign({}, ...result.query.understood.map((u) => u.set)),
            q: result.query.text,
            understand: 'false',
            asked: query,
          });
          return;
        }
        setTotal(result.total);
        setRelaxed(result.relaxed);
        setSuggestion(result.suggestion);
        setMakes(result.facets.make ?? []);
        setHits((prev) => (page === 1 ? result.items : [...prev, ...result.items]));
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, query, category, subcategory, extraKey, page, nonce, understandOff]);

  const more = () => {
    if (!loading && total !== undefined && hits.length < total) setPage((p) => p + 1);
  };

  return (
    <FlatList
      testID="search-results"
      keyboardDismissMode="on-drag"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xl }]}
      data={hits}
      numColumns={2}
      columnWrapperStyle={styles.row}
      keyExtractor={(hit) => hit.id}
      renderItem={({ item }) => <ListingTile hit={item} />}
      onEndReached={more}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        <View style={styles.header}>
          <Field
            testID="search-input"
            inputMode="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            enablesReturnKeyAutomatically
            value={text}
            onChangeText={setText}
            placeholder={m.search.placeholder}
            accessibilityLabel={m.search.placeholder}
            returnKeyType="search"
            onSubmitEditing={() => router.setParams({ q: text.trim(), understand: '', asked: '' })}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            icon={<Icon name="search" size={20} color={theme.muted} />}
          />
          {suggestions && focused ? (
            <View
              testID="search-suggestions"
              style={[
                styles.suggestions,
                { borderColor: theme.border, backgroundColor: theme.surface },
              ]}
            >
              {suggestions.categories.map((c) => (
                <Pressable
                  key={`c-${c.subcategory ?? c.category}`}
                  role="button"
                  testID="suggestion-category"
                  style={styles.suggestion}
                  onPress={() => {
                    setText('');
                    router.setParams({
                      q: '',
                      category: c.category,
                      subcategory: c.subcategory ?? '',
                      understand: '',
                      asked: '',
                    });
                  }}
                >
                  <Icon name="pricetag-outline" size={16} color={theme.muted} />
                  <Text style={[styles.suggestionText, { color: theme.text }]}>
                    {c.subcategory
                      ? (m.taxonomy.subcategories[c.subcategory] ?? c.subcategory)
                      : (m.categories[c.category] ?? c.category)}
                  </Text>
                  <Text style={[styles.small, { color: theme.muted }]}>{c.count}</Text>
                </Pressable>
              ))}
              {suggestions.queries.map((q) => (
                <Pressable
                  key={`q-${q}`}
                  role="button"
                  testID="suggestion-query"
                  style={styles.suggestion}
                  onPress={() => {
                    setText(q);
                    router.setParams({ q, understand: '', asked: '' });
                  }}
                >
                  <Icon name="search" size={16} color={theme.muted} />
                  <Text style={[styles.suggestionText, { color: theme.text }]}>{q}</Text>
                </Pressable>
              ))}
              {suggestions.places.map((p) => (
                <Pressable
                  key={`p-${p.placeId}`}
                  role="button"
                  testID="suggestion-place"
                  style={styles.suggestion}
                  onPress={() => {
                    setText('');
                    router.setParams({ q: '', near: p.placeId });
                  }}
                >
                  <Icon name="location-outline" size={16} color={theme.muted} />
                  <Text style={[styles.suggestionText, { color: theme.text }]}>{p.name}</Text>
                  <Text style={[styles.small, { color: theme.muted }]}>{m.market.nearby}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {asked ? (
            <View style={styles.note} testID="search-understood">
              <Body muted style={styles.flex}>
                {fill(m.market.readAs, { q: asked })}
              </Body>
              <Chip
                testID="search-exact-words"
                label={m.market.exactWords}
                onPress={() => {
                  setText(asked);
                  router.replace({
                    pathname: '/search',
                    params: { q: asked, understand: 'false' },
                  });
                }}
              />
            </View>
          ) : null}
          {relaxed ? (
            <Body muted testID="search-relaxed">
              {m.market.relaxed}
            </Body>
          ) : null}
          {suggestion ? (
            <Chip
              testID="search-did-you-mean"
              label={fill(m.market.didYouMean, { suggestion })}
              onPress={() => {
                setText(suggestion);
                router.setParams({ q: suggestion, understand: '', asked: '' });
              }}
            />
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={styles.bleed}
          >
            <SortMenu
              value={sort}
              options={sorts}
              onChange={(next) => router.setParams({ sort: next === 'relevance' ? '' : next })}
            />
            <Chip
              testID="filter-price-dropped"
              label={m.market.priceReduced}
              selected={reduced}
              onPress={() => router.setParams({ priceDropped: reduced ? '' : 'true' })}
            />
            <Chip
              label={m.home.all}
              selected={!category}
              onPress={() => router.setParams({ category: '', subcategory: '' })}
            />
            {CATEGORIES.map((id) => (
              <Chip
                key={id}
                testID={`filter-${id}`}
                label={m.categories[id] ?? id}
                selected={category === id}
                onPress={() =>
                  router.setParams({
                    category: id,
                    subcategory: '',
                    // Another category's filters do not apply here.
                    ...Object.fromEntries(category ? filterKeys(category).map((k) => [k, '']) : []),
                  })
                }
              />
            ))}
          </ScrollView>
          {category ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              style={styles.bleed}
              testID="subcategory-filters"
            >
              <SearchFilters
                category={category}
                value={extra}
                makes={makes}
                total={total}
                onApply={(filters) => router.setParams(filters)}
              />
              {subcategoriesOf(category).map((id) => (
                <Chip
                  key={id}
                  testID={`filter-sub-${id}`}
                  label={m.taxonomy.subcategories[id] ?? id}
                  selected={subcategory === id}
                  onPress={() => router.setParams({ subcategory: subcategory === id ? '' : id })}
                />
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.totalRow}>
            {total !== undefined ? (
              <Body muted testID="search-total">
                {fill(m.search.results, { count: total })}
              </Body>
            ) : (
              <View />
            )}
            {query || category ? (
              <SaveSearch
                params={{
                  ...extra,
                  ...(query ? { q: query } : {}),
                  ...(category ? { category } : {}),
                  ...(subcategory ? { subcategory } : {}),
                }}
                name={[
                  query ? `«${query}»` : '',
                  category ? m.categories[category] : '',
                  subcategory ? m.taxonomy.subcategories[subcategory] : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                  .slice(0, 80)}
              />
            ) : null}
          </View>
        </View>
      }
      ListEmptyComponent={
        <Status
          loading={loading}
          error={error}
          empty={m.search.noResults}
          onRetry={() => setNonce((n) => n + 1)}
        />
      }
      ListFooterComponent={hits.length > 0 && loading ? <Status loading /> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xl - 4, flexGrow: 1 },
  row: { gap: space.md + 2, marginBottom: space.lg },
  header: { gap: space.lg, marginBottom: space.md },
  bleed: { marginHorizontal: -(space.xl - 4) },
  chips: { gap: space.sm, paddingHorizontal: space.xl - 4 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  saveText: { fontFamily: fonts.semibold, fontSize: 14 },
  suggestions: { borderWidth: 1, borderRadius: radius.lg, paddingVertical: space.xs },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  suggestionText: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  small: { fontFamily: fonts.body, fontSize: 13 },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
