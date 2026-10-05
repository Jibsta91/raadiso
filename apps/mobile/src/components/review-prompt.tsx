import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fill, useI18n } from '../i18n';
import { unwrap, useApi, useLoad } from '../lib/api';
import { haptics } from '../lib/haptics';
import { fonts, radius, space, useTheme } from '../theme';
import { Icon } from './icon';
import { Body, Button, Field } from './ui';

/**
 * Review the other party of a sold listing (ADR-0018), shown in the conversation like on the website.
 * Trust decides who may review (sold, both wrote, within the window, once); the app only asks.
 * Collapsed to one line until the user opens it, so the thread keeps its room.
 */
export function ReviewPrompt({
  listingId,
  subjectId,
  subjectName,
}: {
  listingId: string;
  subjectId: string;
  subjectName: string;
}) {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const eligibility = useLoad(
    async () =>
      unwrap(
        await api.trust.GET('/api/v1/trust/eligibility', {
          params: { query: { listingId, subjectId } },
        }),
      ),
    [api, listingId, subjectId],
  );
  const e = eligibility.data;
  const reviewed = done || (e && !e.canReview && e.reason === 'already_reviewed');
  const card = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }];

  if (reviewed) {
    return (
      <View testID="review-done" style={card}>
        <Body muted style={styles.small}>
          {fill(m.review.done, { name: subjectName })}
        </Body>
        <Pressable role="link" hitSlop={8} onPress={() => router.push(`/users/${subjectId}`)}>
          <Text style={[styles.link, { color: theme.accent }]}>{m.profile.seeProfile}</Text>
        </Pressable>
      </View>
    );
  }
  if (!e?.canReview) return null;

  const title = fill(e.subjectRole === 'seller' ? m.review.titleSeller : m.review.titleBuyer, {
    name: subjectName,
  });

  const submit = async () => {
    if (rating === 0) return setError(m.review.pickRating);
    setSending(true);
    setError(undefined);
    const { response } = await api.trust
      .POST('/api/v1/trust/reviews', { body: { listingId, subjectId, rating, comment } })
      .catch(() => ({ response: { ok: false, status: 0 } }));
    setSending(false);
    // 409: already reviewed (another device); either way the deal is reviewed now.
    if (response.ok || response.status === 409) {
      haptics.success();
      setDone(true);
      return;
    }
    setError(response.status === 429 ? m.review.rateLimited : m.review.error);
  };

  if (!open) {
    return (
      <Pressable
        role="button"
        testID="review-open"
        onPress={() => setOpen(true)}
        style={[...card, styles.row]}
      >
        <Icon name="star-outline" size={20} color={theme.accent} />
        <Text style={[styles.title, styles.grow, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.link, { color: theme.accent }]}>{m.review.rate}</Text>
      </Pressable>
    );
  }

  return (
    <View testID="review-form" style={card}>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <View style={styles.row} role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            role="radio"
            aria-checked={rating === n}
            aria-label={fill(m.review.star, { count: n })}
            testID={`review-star-${n}`}
            hitSlop={4}
            onPress={() => {
              haptics.tap();
              setRating(n);
            }}
          >
            <Icon
              name={n <= rating ? 'star' : 'star-outline'}
              size={30}
              color={n <= rating ? '#f59e0b' : theme.muted}
            />
          </Pressable>
        ))}
      </View>
      <Field
        testID="review-comment"
        placeholder={m.review.comment}
        accessibilityLabel={m.review.comment}
        value={comment}
        onChangeText={setComment}
        maxLength={1000}
        multiline
      />
      <Body muted style={styles.small}>
        {m.review.public}
      </Body>
      {error ? (
        <Text role="alert" testID="review-error" style={[styles.small, { color: theme.danger }]}>
          {error}
        </Text>
      ) : null}
      <Button
        testID="review-submit"
        label={m.review.submit}
        disabled={sending}
        onPress={() => void submit()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  link: { fontFamily: fonts.semibold, fontSize: 14 },
  small: { fontSize: 13, lineHeight: 18 },
});
