import type { MyReview, PendingReview } from '@raadi/api-client';
import { Image } from 'expo-image';
import { Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/icon';
import { NoPhoto } from '../components/no-photo';
import { ReviewPrompt } from '../components/review-prompt';
import { Segmented } from '../components/segmented';
import { Button, Status } from '../components/ui';
import { fill, useI18n } from '../i18n';
import { unwrap, useApi, useLoad, usePaged, usePullToRefresh } from '../lib/api';
import { useAuth } from '../lib/auth/context';
import { config } from '../lib/config';
import { intlLocale } from '../lib/format';
import { absoluteUrl } from '../lib/urls';
import { fonts, radius, space, useTheme } from '../theme';

type Tab = 'received' | 'given';

const DAY = 86_400_000;

/** The listing's first photo, when the listing can still be read (a deleted one cannot). */
function Thumb({ listingId }: { listingId: string }) {
  const api = useApi();
  const theme = useTheme();
  const listing = useLoad(
    async () =>
      unwrap(
        await api.listings.GET('/api/v1/listings/{id}', { params: { path: { id: listingId } } }),
      ),
    [api, listingId],
  );
  const image = listing.data?.images[0];
  return image ? (
    <Image
      source={{ uri: absoluteUrl(image.urls.thumb, config.apiBaseUrl) }}
      style={{ ...styles.thumb, backgroundColor: theme.placeholder }}
    />
  ) : (
    <NoPhoto category={listing.data?.category ?? 'torget'} size={24} style={styles.thumb} />
  );
}

function Stars({ rating }: { rating: number }) {
  const { m } = useI18n();
  return (
    <View style={styles.stars} aria-label={fill(m.review.star, { count: rating })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name={n <= rating ? 'star' : 'star-outline'} size={14} color="#f59e0b" />
      ))}
    </View>
  );
}

/** A finished deal waiting for the user's review, with the days left and the form behind a button. */
function PendingCard({ pending, onDone }: { pending: PendingReview; onDone: () => void }) {
  const { m } = useI18n();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const seller = pending.other.role === 'seller';
  const name = pending.other.name ?? (seller ? m.reviewsPage.theSeller : m.reviewsPage.theBuyer);
  const days = Math.max(0, Math.ceil((Date.parse(pending.deadline) - Date.now()) / DAY));
  return (
    <View
      testID="pending-review"
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text style={[styles.ask, { color: theme.text }]}>
        {fill(seller ? m.reviewsPage.askSeller : m.reviewsPage.askBuyer, { name })}
      </Text>
      <Link href={`/listings/${pending.listing.id}`} asChild>
        <Pressable role="link" style={styles.deal}>
          <Thumb listingId={pending.listing.id} />
          <View style={styles.grow}>
            <Text numberOfLines={2} style={[styles.dealTitle, { color: theme.text }]}>
              {pending.listing.title}
            </Text>
            <Text style={[styles.small, { color: theme.muted }]}>
              {days <= 1 ? m.reviewsPage.lastDay : fill(m.reviewsPage.daysLeft, { count: days })}
            </Text>
          </View>
        </Pressable>
      </Link>
      {open ? (
        <ReviewPrompt
          listingId={pending.listing.id}
          subjectId={pending.other.id}
          subjectName={name}
          initiallyOpen
          onDone={onDone}
        />
      ) : (
        <Button
          testID="pending-review-give"
          label={m.reviewsPage.give}
          onPress={() => setOpen(true)}
        />
      )}
    </View>
  );
}

/** A review the user received or gave, from their side of the deal. */
function ReviewRow({ review, tab }: { review: MyReview; tab: Tab }) {
  const { m, locale } = useI18n();
  const theme = useTheme();
  const seller = review.other.role === 'seller';
  const name = review.other.name ?? (seller ? m.reviewsPage.theSeller : m.reviewsPage.theBuyer);
  const who =
    tab === 'given'
      ? fill(seller ? m.reviewsPage.boughtFrom : m.reviewsPage.soldTo, { name })
      : fill(seller ? m.reviewsPage.fromSeller : m.reviewsPage.fromBuyer, { name });
  return (
    <View
      testID="my-review"
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Link href={`/users/${review.other.id}`} asChild>
        <Pressable role="link">
          <Text style={[styles.who, { color: theme.accent }]}>{who}</Text>
        </Pressable>
      </Link>
      <Text numberOfLines={2} style={[styles.dealTitle, { color: theme.text }]}>
        {review.listing.title}
      </Text>
      <View style={styles.meta}>
        <Stars rating={review.rating} />
        <Text style={[styles.small, { color: theme.muted }]}>
          {new Date(review.createdAt).toLocaleDateString(intlLocale[locale])}
        </Text>
      </View>
      {review.comment ? (
        <Text style={[styles.comment, { color: theme.text }]}>{review.comment}</Text>
      ) : null}
    </View>
  );
}

/** The user's reviews (ADR-0055): deals waiting for a review, and reviews received and given. */
export default function Reviews() {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('received');
  const [chosen, setChosen] = useState(false);
  const pending = useLoad(
    async () =>
      auth.status === 'signedIn'
        ? unwrap(await api.trust.GET('/api/v1/trust/me/pending-reviews'))?.items
        : undefined,
    [api, auth.status],
  );
  const reviews = usePaged(
    async (offset) =>
      auth.status === 'signedIn'
        ? unwrap(
            await api.trust.GET('/api/v1/trust/me/reviews', {
              params: { query: { direction: tab, limit: 20, offset } },
            }),
          )
        : undefined,
    [api, auth.status, tab],
  );
  const waiting = pending.data?.length ?? 0;
  // Deals waiting for a review: open on "Given" until the user picks a tab themselves.
  useEffect(() => {
    if (!chosen && waiting > 0) setTab('given');
  }, [chosen, waiting]);

  const reload = () => {
    pending.reload();
    reviews.reload();
  };
  const refresh = usePullToRefresh(pending.loading || reviews.loading, reload);
  return (
    <>
      <Stack.Screen options={{ title: m.reviewsPage.title }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        {...refresh}
        testID="reviews"
        contentContainerStyle={styles.list}
        data={reviews.items}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <ReviewRow review={item} tab={tab} />}
        onEndReached={reviews.more}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.header}>
            <Segmented
              testID="reviews-tab"
              label={m.reviewsPage.title}
              value={tab}
              onChange={(next) => {
                setChosen(true);
                setTab(next);
              }}
              options={[
                { value: 'received', label: m.reviewsPage.received },
                {
                  value: 'given',
                  label: waiting
                    ? fill(m.reviewsPage.waiting, { count: waiting })
                    : m.reviewsPage.given,
                },
              ]}
            />
            {tab === 'given'
              ? (pending.data ?? []).map((p) => (
                  <PendingCard key={`${p.listing.id}:${p.other.id}`} pending={p} onDone={reload} />
                ))
              : null}
          </View>
        }
        ListEmptyComponent={
          tab === 'given' && waiting > 0 ? null : (
            <Status
              loading={reviews.loading && reviews.items.length === 0}
              error={reviews.error}
              empty={tab === 'given' ? m.reviewsPage.emptyGiven : m.reviewsPage.emptyReceived}
              onRetry={reviews.reload}
            />
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, flexGrow: 1 },
  header: { gap: space.md, paddingBottom: space.sm },
  card: { gap: space.sm + 2, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  ask: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23 },
  deal: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  grow: { flex: 1, gap: 4 },
  dealTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  small: { fontFamily: fonts.body, fontSize: 14 },
  who: { fontFamily: fonts.medium, fontSize: 15 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stars: { flexDirection: 'row', gap: 1 },
  comment: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
});
