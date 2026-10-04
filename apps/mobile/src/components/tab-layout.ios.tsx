import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useI18n } from '../i18n';
import { useUnread } from '../lib/unread';
import { useTheme } from '../theme';

/**
 * The tab layout on iOS: the system tab bar (UITabBarController), which iOS 26 draws in Liquid Glass
 * and shrinks while you scroll down. Icons are SF Symbols, so they match the system's.
 */
export function TabLayout() {
  const { m } = useI18n();
  const theme = useTheme();
  const unread = useUnread();
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={theme.accent}>
      <NativeTabs.Trigger name="index" testID="tab-index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>{m.tabs.home}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" testID="tab-search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>{m.tabs.search}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages" testID="tab-messages">
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'bubble.left.and.bubble.right',
            selected: 'bubble.left.and.bubble.right.fill',
          }}
        />
        <NativeTabs.Trigger.Label>{m.tabs.messages}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread === 0}>{String(unread)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account" testID="tab-account">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
        />
        <NativeTabs.Trigger.Label>{m.tabs.account}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
