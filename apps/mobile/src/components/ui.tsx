import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useI18n } from '../i18n';
import { fonts, radius, space, useTheme } from '../theme';

/**
 * Hides the browser's focus ring on a text input whose container shows focus instead (accent border).
 * Chromium draws `outline-style: auto` whatever the width, so it must be `none`: react-native-web
 * passes that to CSS, while RN's types only list the values native platforms support.
 */
export const noFocusRing = Platform.select<TextStyle>({
  web: { outlineStyle: 'none' } as unknown as TextStyle,
  default: {},
});

/** Screen-level title in the display face ("Discover"-style large title). */
export function LargeTitle({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <Text
      role="heading"
      aria-level={1}
      testID={testID}
      style={[styles.large, { color: theme.text }]}
    >
      {children}
    </Text>
  );
}

export function Title({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <Text
      role="heading"
      aria-level={2}
      testID={testID}
      style={[styles.title, { color: theme.text }]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  style,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Text testID={testID} style={[styles.body, { color: muted ? theme.muted : theme.text }, style]}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ink';
  disabled?: boolean;
  icon?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const colours = {
    primary: { bg: theme.accent, fg: theme.accentText, border: theme.accent },
    ink: { bg: theme.ink, fg: theme.inkText, border: theme.ink },
    secondary: { bg: theme.surface, fg: theme.text, border: theme.border },
  }[variant];
  return (
    <Pressable
      role="button"
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colours.bg,
          borderColor: colours.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {icon}
      <Text style={[styles.buttonText, { color: colours.fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Pill-shaped filter chip; the selected one is filled with the ink colour. */
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      role="button"
      aria-selected={selected}
      testID={testID}
      onPress={onPress}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: theme.ink, borderColor: theme.ink }
          : { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.5}
        style={[styles.chipText, { color: selected ? theme.inkText : theme.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { icon?: ReactNode }) {
  const theme = useTheme();
  const { icon, style, onFocus, onBlur, ...input } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.field,
        {
          borderColor: focused ? theme.accent : theme.border,
          backgroundColor: theme.surface,
          shadowColor: theme.shadow,
        },
      ]}
    >
      {icon}
      <TextInput
        placeholderTextColor={theme.muted}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.fieldInput, noFocusRing, { color: theme.text }, style]}
      />
    </View>
  );
}

/**
 * Frosted "glass" surface (expo-blur; backdrop-filter on the web) with a hairline border and a
 * translucent fill, for floating bars and chips over content.
 */
export function Glass({
  children,
  style,
  testID,
  interactive,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Glass that reacts to touch (iOS 26), for buttons. */
  interactive?: boolean;
}) {
  const theme = useTheme();
  // iOS 26 and later: Apple's Liquid Glass. It follows the app's own Light/Dark choice, not only the
  // system's. Elsewhere (older iOS, Android, web) a blur with a translucent fill stands in.
  if (liquidGlass) {
    return (
      <GlassView
        testID={testID}
        glassEffectStyle="regular"
        isInteractive={interactive}
        colorScheme={theme.scheme}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View
      testID={testID}
      style={[styles.glass, { borderColor: theme.glassBorder, shadowColor: theme.shadow }, style]}
    >
      {/* Backdrop layers sit behind the content: react-native-web leaves a TextInput statically
          positioned, so absolute siblings would otherwise paint (and catch taps) over it. */}
      <BlurView
        pointerEvents="none"
        intensity={60}
        tint={theme.scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={styles.backdrop}
      />
      <View pointerEvents="none" style={[styles.backdrop, { backgroundColor: theme.glass }]} />
      {children}
    </View>
  );
}

/** iOS 26 and later, where Apple's Liquid Glass and its native controls are available. */
export const liquidGlass = Platform.OS === 'ios' && isLiquidGlassAvailable();

/**
 * Screen options for a transparent navigation bar on iOS 26: content scrolls under it with the
 * system's scroll edge effect, as Apple's guidelines ask. The screen's list or scroll view must inset
 * itself with contentInsetAdjustmentBehavior="automatic".
 */
export const glassBar = liquidGlass ? { headerTransparent: true } : {};

/** Loading, error (with retry) and empty states share one centred layout. */
export function Status({
  loading,
  error,
  empty,
  onRetry,
  testID,
}: {
  loading?: boolean;
  error?: boolean;
  empty?: string;
  onRetry?: () => void;
  testID?: string;
}) {
  const { m } = useI18n();
  const theme = useTheme();
  if (loading) {
    return (
      <View style={styles.centred} testID={testID ?? 'loading'}>
        <ActivityIndicator color={theme.accent} accessibilityLabel={m.common.loading} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centred} testID={testID ?? 'error'}>
        <Body muted>{m.common.error}</Body>
        {onRetry ? <Button variant="secondary" label={m.common.retry} onPress={onRetry} /> : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.centred} testID={testID ?? 'empty'}>
        <Body muted style={{ textAlign: 'center' }}>
          {empty}
        </Body>
      </View>
    );
  }
  return null;
}

export function Badge({
  label,
  tone = 'promoted',
  testID,
}: {
  label: string;
  /** promoted: lime; neutral: grey (sold); accent: blue (a price drop); deal: green (a good price). */
  tone?: 'promoted' | 'neutral' | 'accent' | 'deal';
  testID?: string;
}) {
  const theme = useTheme();
  const colours = {
    promoted: { bg: theme.badge, fg: theme.badgeText },
    neutral: { bg: theme.surfaceAlt, fg: theme.subtle },
    accent: { bg: theme.accent, fg: theme.accentText },
    deal: { bg: theme.success, fg: theme.successText },
  }[tone];
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: colours.bg }]}>
      <Text maxFontSizeMultiplier={1.5} style={[styles.badgeText, { color: colours.fg }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  large: { fontFamily: fonts.displayHeavy, fontSize: 36, lineHeight: 40, letterSpacing: -1.4 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.6 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  button: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16 },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
  fieldInput: { flex: 1, minHeight: 48, fontFamily: fonts.body, fontSize: 16 },
  glass: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: -1 },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 12 },
});
