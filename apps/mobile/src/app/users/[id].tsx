import type { Review } from '@raadi/api-client';
import { COUNTRIES } from '@raadi/catalog/countries';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/icon';
import { Body, Status, Title } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { unwrap, useApi, usePaged, usePullToRefresh } from '../../lib/api';
import { useAuth } from '../../lib/auth/context';
import { APP_COUNTRY } from '../../lib/country';
import { confirm } from '../../lib/confirm';
import { formatAge, intlLocale } from '../../lib/format';
import { fonts, radius, space, useTheme } from '../../theme';

const PAGE_SIZE = 20;

function Stars({ rating }: { rating: number }) {
  const theme = useTheme();
  return (
    <View style={styles.stars} accessibilityElementsHidden importantForAccessibility="no">
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon
          key={n}
          name={n <= rating ? 'star' : 'star-outline'}
          size={14}
          color={n <= rating ? '#f59e0b' : theme.muted}
        />
      ))}
    </View>
  );
}

function ReviewRow({ review, onRemoved }: { review: Review; onRemoved: () => void }) {
  const { m, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const mine = auth.user?.id === review.reviewer.id;

  const withdraw = async () => {
    if (
      !(await confirm(m.profile.remove, m.profile.removeConfirm, m.profile.remove, m.swipe.cancel))
    )
      return;
    const { response } = await api.trust
      .DELETE('/api/v1/trust/reviews/{id}', { params: { path: { id: review.id } } })
      .catch(() => ({ response: { ok: false } }));
    if (response.ok) onRemoved();
  };

  return (
    <View
      testID="review"
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <View style={styles.reviewHead}>
        <Stars rating={review.rating} />
        <Text style={[styles.small, { color: theme.muted }]}>
          {fill(m.profile.outOf5, { value: review.rating })} · {formatAge(review.createdAt, locale)}
        </Text>
      </View>
      {review.comment ? <Body>{review.comment}</Body> : null}
      <Link href={`/listings/${review.listing.id}`} asChild>
        <Pressable role="link">
          <Text style={[styles.small, { color: theme.muted }]}>
            {fill(review.subjectRole === 'seller' ? m.profile.byBuyer : m.profile.bySeller, {
              name: review.reviewer.name,
              listing: review.listing.title,
            })}
          </Text>
        </Pressable>
      </Link>
      {mine ? (
        <Pressable
          role="button"
          testID="review-withdraw"
          hitSlop={8}
          onPress={() => void withdraw()}
        >
          <Text style={[styles.action, { color: theme.danger }]}>{m.profile.remove}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A public trust profile (ADR-0018), like the website's /users/<id>: BankID verification, the rating
 * and the reviews. Authors can withdraw their own review here; moderators work on the website.
 */
export default function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { m, locale } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const [profile, setProfile] = useState<{
    name: string;
    verifiedAt: string | null;
    average: number | null;
    count: number;
    distribution: number[];
  }>();
  const reviews = usePaged(
    async (offset) => {
      const data = unwrap(
        await api.trust.GET('/api/v1/trust/users/{id}', {
          params: { path: { id }, query: { limit: PAGE_SIZE, offset } },
        }),
      );
      if (!data) return undefined;
      setProfile({
        name: data.name,
        verifiedAt: data.verification?.verifiedAt ?? null,
        average: data.rating.average,
        count: data.rating.count,
        distribution: data.rating.distribution,
      });
      return data.reviews;
    },
    [api, id],
  );
  const refresh = usePullToRefresh(reviews.loading, reviews.reload);

  if (!profile) {
    return (
      <Status
        loading={reviews.loading}
        error={reviews.error}
        empty={m.profile.notFound}
        onRetry={reviews.reload}
      />
    );
  }

  const most = Math.max(1, ...profile.distribution);
  const header = (
    <View style={styles.header}>
      <View style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: theme.placeholder }]}>
          <Text style={[styles.avatarText, { color: theme.text }]}>{profile.name.slice(0, 1)}</Text>
        </View>
        <View style={styles.grow}>
          <Title testID="profile-name">{profile.name}</Title>
          {/* Verification only where the country has a provider (none in Somaliland yet). */}
          {profile.verifiedAt || COUNTRIES[APP_COUNTRY].identityVerification ? (
            <View style={styles.inline}>
              <Icon
                name={profile.verifiedAt ? 'shield-checkmark' : 'shield-outline'}
                size={14}
                color={profile.verifiedAt ? theme.accent : theme.muted}
              />
              <Text style={[styles.small, { color: theme.muted }]} testID="profile-verification">
                {profile.verifiedAt
                  ? fill(m.profile.verifiedSince, {
                      date: new Date(profile.verifiedAt).toLocaleDateString(intlLocale[locale]),
                    })
                  : m.profile.notVerified}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {profile.average !== null ? (
        <View
          testID="profile-rating"
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <View style={styles.inline}>
            <Text style={[styles.average, { color: theme.text }]}>
              {profile.average.toFixed(1)}
            </Text>
            <Stars rating={Math.round(profile.average)} />
          </View>
          {[5, 4, 3, 2, 1].map((star) => (
            <View key={star} style={styles.inline}>
              <Text style={[styles.small, styles.starLabel, { color: theme.muted }]}>{star}</Text>
              <View style={[styles.bar, { backgroundColor: theme.placeholder }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      backgroundColor: theme.accent,
                      width: `${(100 * (profile.distribution[star - 1] ?? 0)) / most}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <Title>{fill(m.profile.reviews, { count: profile.count })}</Title>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: profile.name }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        {...refresh}
        testID="profile"
        contentContainerStyle={styles.list}
        data={reviews.items}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <ReviewRow review={item} onRemoved={reviews.reload} />}
        onEndReached={reviews.more}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={reviews.loading ? null : <Body muted>{m.profile.noReviews}</Body>}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.xl - 4, gap: space.md, flexGrow: 1 },
  header: { gap: space.lg, marginBottom: space.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display, fontSize: 24 },
  grow: { flex: 1, gap: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  card: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  stars: { flexDirection: 'row', gap: 2 },
  average: { fontFamily: fonts.displayHeavy, fontSize: 32 },
  starLabel: { width: 12, textAlign: 'right' },
  bar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  action: { fontFamily: fonts.semibold, fontSize: 14 },
});
