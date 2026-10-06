import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useI18n } from '../i18n';
import { useUnread, useUnreadNotifications } from '../lib/unread';
import { useTheme } from '../theme';

/**
 * The tab layout on iOS: the system tab bar (UITabBarController), which iOS 26 draws in Liquid Glass. Icons are SF Symbols, so they match the system's.
 */
export function TabLayout() {
  const { m } = useI18n();
  const theme = useTheme();
  const unread = useUnread();
  const alerts = useUnreadNotifications();
  // The screens behind the bar take the app's background (Light or Dark), not the system's default.
  const scene = { backgroundColor: theme.background };
  return (
    <NativeTabs minimizeBehavior="never" tintColor={theme.accent}>
      <NativeTabs.Trigger name="index" contentStyle={scene} testID="tab-index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>{m.tabs.home}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications" contentStyle={scene} testID="tab-notifications">
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} />
        <NativeTabs.Trigger.Label>{m.tabs.alerts}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={alerts === 0}>{String(alerts)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="sell" contentStyle={scene} testID="tab-sell">
        <NativeTabs.Trigger.Icon sf={{ default: 'plus.circle', selected: 'plus.circle.fill' }} />
        <NativeTabs.Trigger.Label>{m.sell.cta}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages" contentStyle={scene} testID="tab-messages">
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'bubble.left.and.bubble.right',
            selected: 'bubble.left.and.bubble.right.fill',
          }}
        />
        <NativeTabs.Trigger.Label>{m.tabs.messages}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread === 0}>{String(unread)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account" contentStyle={scene} testID="tab-account">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
        />
        <NativeTabs.Trigger.Label>{m.tabs.account}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
