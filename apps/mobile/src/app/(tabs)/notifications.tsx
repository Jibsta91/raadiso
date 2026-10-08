import { noticePrices } from '@raadi/catalog/money';
import type { Notification } from '@raadi/api-client';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, LargeTitle, Status } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { unwrap, useApi, useLoad, usePullToRefresh } from '../../lib/api';
import { useAuth } from '../../lib/auth/context';
import { formatAge } from '../../lib/format';
import { notificationPath } from '../../lib/push-path';
import { refreshNotificationBadge } from '../../lib/unread';
import { fonts, radius, space, tabBarSpace, useTheme } from '../../theme';

/**
 * In-app notifications (ADR-0017), the same list as the website's /notifications: removed listings,
 * reviews, promotions, favourites and saved-search matches. Opening one marks it read and goes to
 * the screen it is about.
 */
export default function Notifications() {
  const { m, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Read state changed here, kept until the next reload (the server has it too).
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  const list = useLoad(
    async () =>
      auth.status === 'signedIn'
        ? unwrap(
            await api.notifications.GET('/api/v1/notifications', {
              params: { query: { limit: 50 } },
            }),
          )
        : undefined,
    [api, auth.status],
  );
  const refresh = usePullToRefresh(list.loading, list.reload);
  const items = list.data?.items ?? [];
  const unread = items.filter((n) => !n.read && !read.has(n.id)).length;

  const open = (n: Notification) => {
    if (!n.read && !read.has(n.id)) {
      setRead((prev) => new Set(prev).add(n.id));
      void api.notifications
        .POST('/api/v1/notifications/{id}/read', { params: { path: { id: n.id } } })
        .then(refreshNotificationBadge, () => undefined);
    }
    const path = notificationPath(n.link);
    if (path) router.push(path as never);
  };
  const markAll = async () => {
    const { response } = await api.notifications
      .POST('/api/v1/notifications/read-all')
      .catch(() => ({ response: { ok: false } }));
    if (response.ok) {
      setRead(new Set(items.map((n) => n.id)));
      refreshNotificationBadge();
    }
  };

  if (auth.status !== 'signedIn') {
    return (
      <View style={styles.signedOut}>
        <Status empty={m.notifications.login} />
        <Button label={m.auth.login} onPress={() => void auth.signIn()} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        {...refresh}
        testID="notifications"
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + space.lg, paddingBottom: tabBarSpace + insets.bottom },
        ]}
        ListHeaderComponent={
          <View style={styles.titleRow}>
            <LargeTitle>{m.notifications.title}</LargeTitle>
            {unread > 0 ? (
              <Pressable
                role="button"
                testID="notifications-read-all"
                hitSlop={8}
                onPress={() => void markAll()}
              >
                <Text style={[styles.headerAction, { color: theme.accent }]}>
                  {m.notifications.markAllRead}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => {
          const isUnread = !item.read && !read.has(item.id);
          const text = fill(m.notifications.kinds[item.kind], {
            ...item.params,
            ...noticePrices(item.params, locale),
          });
          return (
            <Pressable
              role="link"
              testID="notification"
              aria-label={text}
              onPress={() => open(item)}
              style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <View
                style={[styles.dot, { backgroundColor: isUnread ? theme.accent : 'transparent' }]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <View style={styles.grow}>
                <Text
                  style={[
                    styles.text,
                    { color: theme.text, fontFamily: isUnread ? fonts.semibold : fonts.body },
                  ]}
                >
                  {text}
                </Text>
                <Text style={[styles.age, { color: theme.muted }]}>
                  {formatAge(item.createdAt, locale)}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Status
            loading={list.loading && items.length === 0}
            error={list.error}
            empty={m.notifications.empty}
            onRetry={list.reload}
          />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xl - 4, gap: space.md, flexGrow: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
  },
  signedOut: { flex: 1, justifyContent: 'center', gap: space.lg, padding: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
  grow: { flex: 1, gap: 4 },
  text: { fontSize: 15, lineHeight: 21 },
  age: { fontFamily: fonts.body, fontSize: 13 },
  // The web build's header has no inset for its right item.
  headerAction: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    marginRight: Platform.OS === 'web' ? space.lg : 0,
  },
});
