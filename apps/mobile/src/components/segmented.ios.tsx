import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '../theme';

/** iOS: SwiftUI's segmented picker, following the app's Light/Dark choice. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  testID,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={theme.scheme}
      style={{ width: '100%' }}
      testID={testID}
    >
      <Picker
        label={label}
        selection={value}
        onSelectionChange={(next) => onChange(next as T)}
        modifiers={[pickerStyle('segmented')]}
      >
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
