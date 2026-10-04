import { Icon } from './icon';
import type { FacetValue } from '@raadi/api-client';
import { ATTRIBUTE_FIELDS, FACET_ATTRIBUTES, RANGE_ATTRIBUTES } from '@raadi/catalog/attributes';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fill, useI18n } from '../i18n';
import type { CategoryId } from '../lib/categories';
import { fonts, space, useTheme } from '../theme';
import { Button, Chip, Field } from './ui';

export type Filters = Record<string, string>;

/** The filter keys a category has (facets, ranges and price), as search parameters. */
export function filterKeys(category: CategoryId): string[] {
  return [
    ...FACET_ATTRIBUTES[category],
    ...RANGE_ATTRIBUTES[category].flatMap((r) => [`${r.param}Min`, `${r.param}Max`]),
    'priceMin',
    'priceMax',
  ];
}

const makeLabel = (make: string) =>
  make.length <= 3 ? make.toUpperCase() : make.charAt(0).toUpperCase() + make.slice(1);

/**
 * The category's own filters in a sheet (FINN-style), like the website's sidebar: chips for the
 * facets, "from – to" for numbers. Applying sets the search's route parameters.
 */
export function SearchFilters({
  category,
  value,
  makes,
  total,
  onApply,
}: {
  category: CategoryId;
  value: Filters;
  /** Car makes with counts, from the latest results. */
  makes: FacetValue[];
  total: number | undefined;
  onApply: (filters: Filters) => void;
}) {
  const { m } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(value);
  const key = JSON.stringify(value);
  useEffect(() => setDraft(JSON.parse(key) as Filters), [key]);

  const active = filterKeys(category).filter((k) => value[k]).length;
  const labels = m.taxonomy.attributes as Record<string, string>;
  const values = m.taxonomy.values as Record<string, Record<string, string>>;
  const selected = (k: string) => (draft[k] ?? '').split(',').filter(Boolean);
  const toggle = (k: string, v: string) => {
    const now = selected(k);
    const next = now.includes(v) ? now.filter((x) => x !== v) : [...now, v];
    setDraft((d) => ({ ...d, [k]: next.join(',') }));
  };
  const options = (k: string): Array<{ value: string; label: string }> => {
    if (k === 'make')
      return makes.map((f) => ({ value: f.value, label: `${makeLabel(f.value)} · ${f.count}` }));
    const field = ATTRIBUTE_FIELDS[category].find((f) => f.key === k);
    return field?.kind === 'select'
      ? field.options.map((o) => ({ value: o, label: values[k]?.[o] ?? o }))
      : [];
  };
  const ranges = [
    ...RANGE_ATTRIBUTES[category].map((r) => ({
      param: r.param,
      label: labels[r.field] ?? r.param,
    })),
    { param: 'price', label: m.sell.price },
  ];

  return (
    <>
      <Chip
        testID="open-filters"
        label={active ? `${m.filters.title} (${active})` : m.filters.title}
        selected={active > 0}
        onPress={() => setOpen(true)}
      />
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.background, paddingBottom: insets.bottom + space.md },
          ]}
        >
          <View style={[styles.head, { borderColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>{m.filters.title}</Text>
            <Pressable
              role="button"
              aria-label={m.filters.close}
              hitSlop={8}
              onPress={() => setOpen(false)}
            >
              <Icon name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {FACET_ATTRIBUTES[category].map((k) =>
              options(k).length ? (
                <View key={k} style={styles.group}>
                  <Text style={[styles.label, { color: theme.text }]}>{labels[k] ?? k}</Text>
                  <View style={styles.chips}>
                    {options(k).map((o) => (
                      <Chip
                        key={o.value}
                        testID={`filter-${k}-${o.value}`}
                        label={o.label}
                        selected={selected(k).includes(o.value)}
                        onPress={() => toggle(k, o.value)}
                      />
                    ))}
                  </View>
                </View>
              ) : null,
            )}
            {ranges.map((r) => (
              <View key={r.param} style={styles.group}>
                <Text style={[styles.label, { color: theme.text }]}>{r.label}</Text>
                <View style={styles.range}>
                  {(['Min', 'Max'] as const).map((which) => (
                    <View key={which} style={styles.grow}>
                      <Field
                        testID={`filter-${r.param}${which}`}
                        value={draft[`${r.param}${which}`] ?? ''}
                        onChangeText={(t) =>
                          setDraft((d) => ({ ...d, [`${r.param}${which}`]: t.replace(/\D/g, '') }))
                        }
                        keyboardType="number-pad"
                        maxLength={10}
                        placeholder={which === 'Min' ? m.filters.from : m.filters.to}
                        accessibilityLabel={`${r.label} ${which === 'Min' ? m.filters.from : m.filters.to}`}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Button
              testID="filters-clear"
              variant="secondary"
              label={m.filters.clear}
              onPress={() => setDraft(Object.fromEntries(filterKeys(category).map((k) => [k, ''])))}
            />
            <Button
              testID="filters-apply"
              label={total === undefined ? m.filters.apply : fill(m.filters.show, { count: total })}
              onPress={() => {
                onApply(Object.fromEntries(filterKeys(category).map((k) => [k, draft[k] ?? ''])));
                setOpen(false);
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  body: { padding: space.lg, gap: space.xl },
  group: { gap: space.sm },
  label: { fontFamily: fonts.semibold, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  range: { flexDirection: 'row', gap: space.sm },
  grow: { flex: 1 },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    justifyContent: 'flex-end',
  },
});
