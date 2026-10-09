import { Host, Menu, Picker, Text } from '@expo/ui/swift-ui';
import { tag } from '@expo/ui/swift-ui/modifiers';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import type { Sort } from '../lib/sort';

/** iOS: a SwiftUI pull-down menu with the orders, the current one ticked (as in Mail and Files). */
export function SortMenu({
  value,
  options,
  onChange,
}: {
  value: Sort;
  options: readonly Sort[];
  onChange: (sort: Sort) => void;
}) {
  const { m } = useI18n();
  const theme = useTheme();
  const labels = m.sort as Record<string, string>;
  return (
    <Host matchContents colorScheme={theme.scheme} testID="sort">
      <Menu label={labels[value] ?? value} systemImage="arrow.up.arrow.down">
        <Picker
          label={m.sort.label}
          selection={value}
          onSelectionChange={(next) => onChange(next as Sort)}
        >
          {options.map((sort) => (
            <Text key={sort} modifiers={[tag(sort)]}>
              {labels[sort] ?? sort}
            </Text>
          ))}
        </Picker>
      </Menu>
    </Host>
  );
}
