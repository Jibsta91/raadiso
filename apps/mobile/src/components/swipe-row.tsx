import { cloneElement, isValidElement, useRef, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { haptics } from '../lib/haptics';
import { fonts, radius, space } from '../theme';
import { Icon, type IconName } from './icon';

export interface SwipeAction {
  /** Unique within the row; also the VoiceOver action's name. */
  key: string;
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}

/**
 * A list row with swipe actions (swipe left to reveal them), as in Mail and Messages. VoiceOver users
 * get the same actions from the rotor (Apple's guidelines: never only behind a gesture). On the web the
 * row is shown as it is.
 */
export function SwipeRow({
  actions,
  children,
}: {
  actions: SwipeAction[];
  children: ReactElement<{
    accessibilityActions?: { name: string; label: string }[];
    onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void;
  }>;
}) {
  const swipeable = useRef<SwipeableMethods>(null);
  if (Platform.OS === 'web' || actions.length === 0) return children;
  const run = (action: SwipeAction) => {
    swipeable.current?.close();
    haptics.tap();
    action.onPress();
  };
  const row = isValidElement(children)
    ? cloneElement(children, {
        accessibilityActions: actions.map((a) => ({ name: a.key, label: a.label })),
        onAccessibilityAction: (e) => {
          const action = actions.find((a) => a.key === e.nativeEvent.actionName);
          if (action) run(action);
        },
      })
    : children;
  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              role="button"
              aria-label={action.label}
              testID={`swipe-${action.key}`}
              onPress={() => run(action)}
              style={[styles.action, { backgroundColor: action.color }]}
            >
              <Icon name={action.icon} size={20} color="#fff" />
              <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={styles.label}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space.xs, paddingLeft: space.sm },
  action: {
    width: 84,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
  label: { color: '#fff', fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center' },
});
