import type { Message } from '@raadi/api-client';
import { Icon } from '../../components/icon';
import { haptics } from '../../lib/haptics';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoPhoto } from '../../components/no-photo';
import { ReviewPrompt } from '../../components/review-prompt';
import { Body, Button, Glass, noFocusRing, Status } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { confirm } from '../../lib/confirm';
import { unwrap, useApi, useLoad } from '../../lib/api';
import { config } from '../../lib/config';
import { formatAge } from '../../lib/format';
import { useRealtime } from '../../lib/realtime';
import { absoluteUrl } from '../../lib/urls';
import { fonts, radius, space, useTheme } from '../../theme';

function Bubble({ message }: { message: Message }) {
  const { locale } = useI18n();
  const theme = useTheme();
  const mine = message.fromMe;
  return (
    <View
      testID={mine ? 'message-mine' : 'message-theirs'}
      style={[
        styles.bubble,
        mine
          ? { alignSelf: 'flex-end', backgroundColor: theme.accent, borderBottomRightRadius: 6 }
          : { alignSelf: 'flex-start', backgroundColor: theme.surface, borderBottomLeftRadius: 6 },
      ]}
    >
      <Text style={[styles.bubbleText, { color: mine ? theme.accentText : theme.text }]}>
        {message.body}
      </Text>
      <Text style={[styles.time, { color: mine ? theme.accentText : theme.muted }]}>
        {formatAge(message.sentAt, locale)}
      </Text>
    </View>
  );
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Message>>(null);
  // Scroll handling: follow new messages only when the reader is at the bottom, and keep the
  // visible message in place when older history is prepended above it.
  const atBottom = useRef(true);
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const prepending = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  // Either side blocked the other (ADR-0027): no composer; the blocked side is not told why.
  const [closed, setClosed] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);

  const detail = useLoad(
    async () =>
      unwrap(
        await api.messaging.GET('/api/v1/messaging/conversations/{id}', {
          params: { path: { id } },
        }),
      ),
    [api, id],
  );

  const markRead = useCallback(() => {
    void api.messaging
      .POST('/api/v1/messaging/conversations/{id}/read', { params: { path: { id } } })
      .catch(() => undefined);
  }, [api, id]);

  useEffect(() => {
    if (!detail.data) return;
    setMessages(detail.data.messages);
    setHasMore(detail.data.hasMore);
    setClosed(!detail.data.canMessage);
    setBlockedByMe(detail.data.blockedByMe);
    markRead();
  }, [detail.data, markRead]);

  const append = useCallback((message: Message) => {
    setMessages((prev) => (prev.some((m2) => m2.id === message.id) ? prev : [...prev, message]));
  }, []);

  useRealtime((event) => {
    if (event.type === 'message' && event.message.conversationId === id) {
      append(event.message);
      if (!event.message.fromMe) markRead();
    }
  });

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const res = await api.messaging.GET('/api/v1/messaging/conversations/{id}', {
      params: { path: { id }, query: { before: oldest.sentAt } },
    });
    if (!res.data) return;
    const older = res.data.messages;
    if (older.length > 0) prepending.current = true;
    setMessages((prev) => [...older.filter((o) => !prev.some((p) => p.id === o.id)), ...prev]);
    setHasMore(res.data.hasMore);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendError(false);
    try {
      const res = await api.messaging.POST('/api/v1/messaging/conversations/{id}/messages', {
        params: { path: { id } },
        body: { body },
      });
      if (res.data) {
        haptics.success();
        atBottom.current = true;
        append(res.data);
        setDraft('');
      } else if (
        (res.error as { errors?: Array<{ code?: string }> } | undefined)?.errors?.[0]?.code ===
        'conversation_closed'
      ) {
        setClosed(true);
      } else {
        setSendError(true);
      }
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const setBlocked = async (block: boolean, name: string) => {
    if (
      block &&
      !(await confirm(
        fill(m.messages.block, { name }),
        m.messages.blockConfirm,
        m.messages.blockOk,
        m.messages.cancel,
      ))
    )
      return;
    const path = { params: { path: { id } } };
    const res = await (
      block
        ? api.messaging.PUT('/api/v1/messaging/conversations/{id}/block', path)
        : api.messaging.DELETE('/api/v1/messaging/conversations/{id}/block', path)
    ).catch(() => null);
    if (res?.data) {
      setClosed(!res.data.canMessage);
      setBlockedByMe(res.data.blockedByMe);
    }
  };

  if (!detail.data) {
    return (
      <Status
        loading={detail.loading}
        error={detail.error}
        empty={m.messages.empty}
        onRetry={detail.reload}
      />
    );
  }
  const conversation = detail.data;

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          title: conversation.counterpart.name,
          headerRight: () =>
            blockedByMe ? null : (
              <Pressable
                role="button"
                testID="block"
                aria-label={fill(m.messages.block, { name: conversation.counterpart.name })}
                hitSlop={8}
                onPress={() => void setBlocked(true, conversation.counterpart.name)}
              >
                <Icon name="ban-outline" size={22} color={theme.muted} />
              </Pressable>
            ),
        }}
      />
      <Link href={`/listings/${conversation.listing.id}`} asChild>
        {/* Link asChild spreads props: one style object, not an array (see listing-card.tsx). */}
        <Pressable
          role="link"
          aria-label={conversation.listing.title}
          style={{ ...styles.header, backgroundColor: theme.surface, borderColor: theme.border }}
        >
          {conversation.listing.image ? (
            <Image
              source={{ uri: absoluteUrl(conversation.listing.image.thumb, config.apiBaseUrl) }}
              style={{ ...styles.headerThumb, backgroundColor: theme.placeholder }}
            />
          ) : (
            <NoPhoto size={20} style={styles.headerThumb} />
          )}
          <View style={styles.headerText}>
            <Body style={styles.listingTitle} testID="conversation-listing">
              {conversation.listing.title}
            </Body>
            <Body muted style={styles.small}>
              {conversation.role === 'buyer' ? m.messages.roleBuyer : m.messages.roleSeller}
            </Body>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.muted} />
        </Pressable>
      </Link>
      <ReviewPrompt
        listingId={conversation.listing.id}
        subjectId={conversation.counterpart.id}
        subjectName={conversation.counterpart.name}
      />
      <FlatList
        ref={list}
        testID="thread"
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.thread}
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <Bubble message={item} />}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          scrollY.current = contentOffset.y;
          atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
        }}
        onContentSizeChange={(_, height) => {
          const grown = height - contentHeight.current;
          contentHeight.current = height;
          if (prepending.current) {
            prepending.current = false;
            list.current?.scrollToOffset({ offset: scrollY.current + grown, animated: false });
          } else if (atBottom.current) {
            list.current?.scrollToEnd({ animated: false });
          }
        }}
        ListHeaderComponent={
          hasMore ? (
            <Button variant="secondary" label={m.messages.older} onPress={() => void loadOlder()} />
          ) : null
        }
      />
      {sendError ? (
        <Body style={{ color: theme.danger, paddingHorizontal: space.lg }}>
          {m.messages.errors.generic}
        </Body>
      ) : null}
      {closed ? (
        <View
          testID="thread-closed"
          style={[
            styles.closed,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              marginBottom: Math.max(insets.bottom, space.md),
            },
          ]}
        >
          <Body muted style={styles.small}>
            {blockedByMe
              ? fill(m.messages.blockedByMe, { name: conversation.counterpart.name })
              : m.messages.closed}
          </Body>
          {blockedByMe ? (
            <Button
              testID="unblock"
              variant="secondary"
              label={m.messages.unblock}
              onPress={() => void setBlocked(false, conversation.counterpart.name)}
            />
          ) : null}
        </View>
      ) : (
        <Glass
          style={[
            styles.composer,
            { marginBottom: Math.max(insets.bottom, space.md) },
            composerFocused ? { borderColor: theme.accent } : null,
          ]}
        >
          <TextInput
            testID="compose"
            value={draft}
            onChangeText={setDraft}
            placeholder={m.messages.compose}
            placeholderTextColor={theme.muted}
            accessibilityLabel={m.messages.compose}
            multiline
            maxLength={2000}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            style={[styles.composerInput, noFocusRing, { color: theme.text }]}
          />
          <Pressable
            role="button"
            testID="send"
            aria-label={sending ? m.messages.sending : m.messages.send}
            disabled={sending || draft.trim().length === 0}
            onPress={() => void send()}
            style={[
              styles.sendButton,
              { backgroundColor: theme.accent, opacity: sending || !draft.trim() ? 0.5 : 1 },
            ]}
          >
            <Icon name="arrow-up" size={22} color={theme.accentText} />
          </Pressable>
        </Glass>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  headerThumb: { width: 44, height: 44, borderRadius: radius.sm - 2 },
  headerText: { flex: 1 },
  listingTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  small: { fontSize: 13, lineHeight: 18 },
  thread: { padding: space.lg, gap: space.sm, flexGrow: 1, justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 20,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md + 2,
    gap: 2,
  },
  bubbleText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  time: { fontFamily: fonts.body, fontSize: 11, opacity: 0.75 },
  closed: {
    gap: space.sm,
    marginHorizontal: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    marginHorizontal: space.md,
    padding: space.sm,
    borderRadius: 28,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: space.md,
    paddingTop: 12,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
