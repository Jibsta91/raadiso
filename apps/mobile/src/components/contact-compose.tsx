import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import type { Messages } from '../i18n/messages';
import { useApi } from '../lib/api';
import { haptics } from '../lib/haptics';
import { space, useTheme } from '../theme';
import { Body, Button, Field } from './ui';

type ErrorKey = keyof Messages['messages']['errors'];

function problemCode(body: unknown): ErrorKey {
  const code = (body as { errors?: { code?: string }[] } | undefined)?.errors?.[0]?.code;
  return code === 'own_listing' || code === 'listing_unavailable' || code === 'rate_limited'
    ? code
    : 'generic';
}

/** The first message to a seller: starts the conversation and hands its id to `onSent`. */
export function ContactCompose({
  listingId,
  onCancel,
  onSent,
}: {
  listingId: string;
  onCancel: () => void;
  onSent: (conversationId: string) => void;
}) {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const [body, setBody] = useState(m.contact.defaultText);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKey>();

  const send = async () => {
    setSending(true);
    setError(undefined);
    try {
      const res = await api.messaging.POST('/api/v1/messaging/conversations', {
        body: { listingId, body: body.trim() },
      });
      if (res.data) {
        haptics.success();
        onSent(res.data.conversation.id);
      } else {
        setError(res.response.status === 429 ? 'rate_limited' : problemCode(res.error));
      }
    } catch {
      setError('generic');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.compose}>
      <Field
        testID="contact-body"
        value={body}
        onChangeText={setBody}
        placeholder={m.contact.placeholder}
        accessibilityLabel={m.contact.placeholder}
        multiline
        maxLength={2000}
        autoFocus
      />
      {error ? <Body style={{ color: theme.danger }}>{m.messages.errors[error]}</Body> : null}
      <View style={styles.actions}>
        <View style={styles.grow}>
          <Button
            testID="contact-send"
            label={sending ? m.messages.sending : m.contact.send}
            disabled={sending || body.trim().length === 0}
            onPress={() => void send()}
          />
        </View>
        <Button variant="secondary" label={m.common.back} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compose: { gap: space.sm + 2 },
  actions: { flexDirection: 'row', gap: space.sm },
  grow: { flex: 1 },
});
