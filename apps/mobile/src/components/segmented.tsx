import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, radius, useTheme } from '../theme';

/** Segmented control (Android and the web); iOS uses SwiftUI's (segmented.ios.tsx). */
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
    <View
      role="radiogroup"
      aria-label={label}
      testID={testID}
      style={[styles.segmented, { backgroundColor: theme.surfaceAlt }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={selected}
            testID={`${testID}-${option.value}`}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              selected && [
                styles.selected,
                { backgroundColor: theme.surface, shadowColor: theme.shadow },
              ],
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: selected ? theme.text : theme.muted },
                selected && { fontFamily: fonts.semibold },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: 'row', padding: 4, borderRadius: radius.md, gap: 4 },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md - 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6 },
  segmentText: { fontFamily: fonts.medium, fontSize: 15 },
});
