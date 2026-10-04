import { Host, Menu, Picker, Text } from '@expo/ui/swift-ui';
import { tag } from '@expo/ui/swift-ui/modifiers';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { SORTS, type Sort } from './sort-menu';

export type { Sort };

/** iOS: a SwiftUI pull-down menu with the orders, the current one ticked (as in Mail and Files). */
export function SortMenu({ value, onChange }: { value: Sort; onChange: (sort: Sort) => void }) {
  const { m } = useI18n();
  const theme = useTheme();
  return (
    <Host matchContents colorScheme={theme.scheme} testID="sort">
      <Menu label={m.sort[value]} systemImage="arrow.up.arrow.down">
        <Picker
          label={m.sort.label}
          selection={value}
          onSelectionChange={(next) => onChange(next as Sort)}
        >
          {SORTS.map((sort) => (
            <Text key={sort} modifiers={[tag(sort)]}>
              {m.sort[sort]}
            </Text>
          ))}
        </Picker>
      </Menu>
    </Host>
  );
}
