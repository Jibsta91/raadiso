import type { Conversation } from '@raadi/api-client';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoPhoto } from '../../components/no-photo';
import { Body, Button, LargeTitle, Status } from '../../components/ui';
import { useI18n } from '../../i18n';
import { unwrap, useApi, usePaged, usePullToRefresh } from '../../lib/api';
import { useAuth } from '../../lib/auth/context';
import { config } from '../../lib/config';
import { formatAge } from '../../lib/format';
import { useRealtime } from '../../lib/realtime';
import { absoluteUrl } from '../../lib/urls';
import { fonts, radius, space, tabBarSpace, useTheme } from '../../theme';

const PAGE_SIZE = 20;

function Row({ conversation }: { conversation: Conversation }) {
  const { locale } = useI18n();
  const theme = useTheme();
  const unread = conversation.unread > 0;
  return (
    <Link href={`/messages/${conversation.id}`} asChild>
      {/* Link asChild spreads props: one style object, not an array (see listing-card.tsx). */}
      <Pressable
        testID="conversation"
        role="link"
        aria-label={[
          conversation.counterpart.name,
          conversation.listing.title,
          conversation.lastMessage?.body,
          conversation.lastMessage ? formatAge(conversation.lastMessage.sentAt, locale) : undefined,
        ]
          .filter(Boolean)
          .join(', ')}
        style={{ ...styles.row, backgroundColor: theme.surface, borderColor: theme.border }}
      >
        {conversation.listing.image ? (
          <Image
            source={{ uri: absoluteUrl(conversation.listing.image.thumb, config.apiBaseUrl) }}
            style={{ ...styles.thumb, backgroundColor: theme.placeholder }}
          />
        ) : (
          <NoPhoto size={24} style={styles.thumb} />
        )}
        <View style={styles.text}>
          <View style={styles.line}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
              {conversation.counterpart.name}
            </Text>
            {conversation.lastMessage ? (
              <Text style={[styles.time, { color: theme.muted }]}>
                {formatAge(conversation.lastMessage.sentAt, locale)}
              </Text>
            ) : null}
          </View>
          <Text numberOfLines={1} style={[styles.listing, { color: theme.muted }]}>
            {conversation.listing.title}
          </Text>
          {conversation.lastMessage ? (
            <Text
              numberOfLines={1}
              style={[
                styles.preview,
                { color: theme.text, fontFamily: unread ? fonts.semibold : fonts.body },
              ]}
            >
              {conversation.lastMessage.body}
            </Text>
          ) : null}
        </View>
        {unread ? (
          <View testID="unread" style={[styles.dot, { backgroundColor: theme.accent }]}>
            <Text style={[styles.dotText, { color: theme.accentText }]}>{conversation.unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

function Inbox({ top }: { top: number }) {
  const { m } = useI18n();
  const api = useApi();
  const inbox = usePaged(
    async (offset) =>
      unwrap(
        await api.messaging.GET('/api/v1/messaging/conversations', {
          params: { query: { limit: PAGE_SIZE, offset } },
        }),
      ),
    [api],
  );
  useRealtime((event) => event.type !== 'hello' && inbox.reload());

  const refresh = usePullToRefresh(inbox.loading, inbox.reload);
  return (
    <FlatList
      contentContainerStyle={[styles.list, { paddingTop: top, paddingBottom: tabBarSpace }]}
      data={inbox.items}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <Row conversation={item} />}
      {...refresh}
      onEndReached={inbox.more}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={<LargeTitle>{m.messages.title}</LargeTitle>}
      ListEmptyComponent={
        <Status
          loading={inbox.loading && inbox.items.length === 0}
          error={inbox.error}
          empty={m.messages.empty}
          onRetry={inbox.reload}
        />
      }
    />
  );
}

export default function Messages() {
  const { m } = useI18n();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const top = insets.top + space.lg;
  if (auth.status === 'loading') return <Status loading />;
  if (auth.status === 'signedOut') {
    return (
      <View style={[styles.signedOut, { paddingTop: top }]}>
        <LargeTitle>{m.messages.title}</LargeTitle>
        <View style={styles.signedOutBody}>
          <Body muted style={{ textAlign: 'center' }}>
            {m.messages.login}
          </Body>
          <Button testID="login" label={m.auth.login} onPress={() => void auth.signIn()} />
        </View>
      </View>
    );
  }
  return <Inbox top={top} />;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xl - 4, gap: space.sm + 2, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg - 2,
    borderWidth: 1,
  },
  thumb: { width: 60, height: 60, borderRadius: radius.md - 4 },
  text: { flex: 1, gap: 1 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { flex: 1, fontFamily: fonts.semibold, fontSize: 16 },
  time: { fontFamily: fonts.body, fontSize: 12 },
  listing: { fontFamily: fonts.body, fontSize: 13 },
  preview: { fontSize: 15 },
  dot: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  dotText: { fontFamily: fonts.bold, fontSize: 12 },
  signedOut: { flex: 1, paddingHorizontal: space.xl - 4 },
  signedOutBody: { flex: 1, justifyContent: 'center', gap: space.lg, paddingBottom: tabBarSpace },
});
