import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './ui';
import { useI18n } from '../i18n';
import { useUnread } from '../lib/unread';
import { fonts, radius, space, useTheme } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

const BAR_PADDING = space.sm;
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['home', 'home-outline'],
  search: ['search', 'search-outline'],
  messages: ['chatbubbles', 'chatbubbles-outline'],
  account: ['person-circle', 'person-circle-outline'],
};

/**
 * Floating "glass" bar with a sliding highlight. Tap a tab and the highlight glides to it, or put a
 * finger on the bar and slide sideways: the highlight follows the finger and the tab under it is chosen
 * on release (like iOS's segmented controls). Built on React Native's PanResponder and Animated, so it
 * needs no native gesture library and works the same in Expo Go and the web build.
 */
function GlassTabBar({ state, descriptors, navigation }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const count = state.routes.length;
  const bar = useRef<View>(null);
  const [frame, setFrame] = useState({ x: 0, slot: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const position = useRef(new Animated.Value(0)).current;
  const shown = hover ?? state.index;

  const measure = () =>
    bar.current?.measureInWindow((x, _y, width) =>
      setFrame({ x: x + BAR_PADDING, slot: (width - 2 * BAR_PADDING) / count }),
    );

  const glideTo = useCallback(
    (index: number) =>
      Animated.spring(position, {
        toValue: index * frame.slot,
        useNativeDriver: Platform.OS !== 'web',
        speed: 20,
        bounciness: 6,
      }).start(),
    [position, frame.slot],
  );

  // Follow the focused tab, however it changed (tap, drag, deep link, back navigation).
  useEffect(() => glideTo(state.index), [glideTo, state.index]);

  const select = useCallback(
    (index: number) => {
      const route = state.routes[index];
      if (!route) return;
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (index !== state.index && !event.defaultPrevented) navigation.navigate(route.name);
    },
    [navigation, state.index, state.routes],
  );

  // Pill position (left edge, px) for a finger at pageX, kept inside the bar.
  const follow = useCallback(
    (pageX: number) => {
      const max = (count - 1) * frame.slot;
      const left = Math.min(Math.max(pageX - frame.x - frame.slot / 2, 0), max);
      position.setValue(left);
      setHover(Math.round(left / frame.slot));
      return left;
    },
    [count, frame, position],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Taps stay with the tabs; a mostly sideways move on the bar becomes a slide.
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: (e) => follow(e.nativeEvent.pageX),
        onPanResponderMove: (e) => follow(e.nativeEvent.pageX),
        onPanResponderRelease: (e) => {
          const index = Math.round(follow(e.nativeEvent.pageX) / frame.slot);
          setHover(null);
          if (index === state.index) glideTo(index);
          else select(index);
        },
        onPanResponderTerminate: () => {
          setHover(null);
          glideTo(state.index);
        },
      }),
    [follow, frame.slot, glideTo, select, state.index],
  );

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, space.md) }]}
    >
      <View ref={bar} onLayout={measure} style={styles.barFrame} {...pan.panHandlers}>
        <Glass style={styles.bar} testID="tab-bar">
          {frame.slot > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pill,
                {
                  width: frame.slot,
                  backgroundColor: theme.ink,
                  transform: [{ translateX: position }],
                },
              ]}
            />
          ) : null}
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const lit = shown === index;
            const options = descriptors[route.key]?.options;
            const label = options?.title ?? route.name;
            const badge = options?.tabBarBadge;
            const [active, inactive] = ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
            const color = lit ? theme.inkText : theme.subtle;
            return (
              <Pressable
                key={route.key}
                role="tab"
                aria-selected={focused}
                aria-label={badge ? `${label}, ${badge}` : label}
                testID={`tab-${route.name}`}
                onPress={() => select(index)}
                style={styles.tab}
              >
                <View>
                  <Ionicons name={lit ? active : inactive} size={22} color={color} />
                  {badge ? (
                    <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                      <Text style={[styles.badgeText, { color: theme.accentText }]}>{badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={[styles.label, { color }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Glass>
      </View>
    </View>
  );
}

/** The tab layout on Android and the web: Expo Router's tabs with the floating glass bar. */
export function TabLayout() {
  const { m } = useI18n();
  const theme = useTheme();
  const unread = useUnread();
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.background } }}
    >
      <Tabs.Screen name="index" options={{ title: m.tabs.home }} />
      <Tabs.Screen name="search" options={{ title: m.tabs.search }} />
      <Tabs.Screen
        name="messages"
        options={{ title: m.tabs.messages, tabBarBadge: unread > 0 ? unread : undefined }}
      />
      <Tabs.Screen name="account" options={{ title: m.tabs.account }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  barFrame: { width: '100%', maxWidth: 420 },
  bar: {
    height: 68,
    borderRadius: 34,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: BAR_PADDING,
  },
  pill: {
    position: 'absolute',
    left: BAR_PADDING,
    top: 8,
    bottom: 8,
    borderRadius: radius.pill,
  },
  tab: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 11 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 11 },
});
