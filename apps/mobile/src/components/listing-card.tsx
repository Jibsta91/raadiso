import type { SearchHit } from '@raadi/api-client';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { fill, useI18n } from '../i18n';
import { config } from '../lib/config';
import { dropPercent, formatAge, formatPrice, type Locale } from '../lib/format';
import type { Messages } from '../i18n/messages';
import { useAuth } from '../lib/auth/context';
import { useFavourite } from '../lib/saved';
import { absoluteUrl } from '../lib/urls';
import { Icon } from './icon';
import { NoPhoto } from './no-photo';
import { fonts, radius, space, useTheme } from '../theme';
import { Badge, Glass } from './ui';

// On the web, expo-image and a Pressable inside `Link asChild` hand styles to the DOM: always pass
// one style object there, never an array (an array arrives as {0: …} and React DOM throws).
// The heart is a sibling of the link, never inside it: a button inside an anchor is invalid HTML,
// and on the web its click would also follow the link.

/** What a card shows: a search hit, a favourite (which may be sold) or a recently viewed listing. */
export type TileListing = Pick<SearchHit, 'id' | 'title' | 'price' | 'category'> & {
  image?: { card: string };
  location: { name: string };
  promoted?: boolean;
  sold?: boolean;
  /** A good price against similar listings (ADR-0043). */
  deal?: SearchHit['deal'];
  /** A recent price drop (ADR-0044). */
  priceDrop?: SearchHit['priceDrop'];
  publishedAt?: string;
  imageCount?: number;
};

function Photo({ hit, style }: { hit: TileListing; style: object }) {
  const theme = useTheme();
  return hit.image ? (
    <Image
      source={{ uri: absoluteUrl(hit.image.card, config.apiBaseUrl) }}
      style={{ ...style, backgroundColor: theme.placeholder }}
      contentFit="cover"
      transition={150}
      recyclingKey={hit.id}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <NoPhoto category={hit.category} size={36} style={style} />
  );
}

/** The heart over a card's photo: saves the listing without opening it, with a small pop. */
export function HeartButton({ id, size = 34 }: { id: string; size?: number }) {
  const { m } = useI18n();
  const theme = useTheme();
  const favourite = useFavourite(id);
  const signedIn = useAuth().status === 'signedIn';
  const scale = useRef(new Animated.Value(1)).current;
  // The pop follows the user's own tap, not the favourites arriving from the server.
  const press = () => {
    if (!favourite.saved && signedIn) {
      scale.setValue(0.6);
      Animated.spring(scale, {
        toValue: 1,
        friction: 3,
        tension: 160,
        useNativeDriver: true,
      }).start();
    }
    void favourite.toggle();
  };
  return (
    <Pressable
      role="button"
      testID="tile-favourite"
      aria-label={favourite.saved ? m.favourites.remove : m.favourites.add}
      aria-pressed={favourite.saved}
      hitSlop={8}
      onPress={press}
    >
      <Glass
        style={[styles.heart, { width: size, height: size, borderRadius: size / 2 }]}
        interactive
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <Icon
            name={favourite.saved ? 'heart' : 'heart-outline'}
            size={Math.round(size * 0.53)}
            color={favourite.saved ? HEART : theme.text}
          />
        </Animated.View>
      </Glass>
    </Pressable>
  );
}

/** The badge in a card's corner: sold, promoted, a price drop or a good deal, in that order. */
function CornerBadge({ hit }: { hit: TileListing }) {
  const { m } = useI18n();
  const pct = dropPercent(hit);
  if (hit.sold) return <Badge label={m.listing.sold} tone="neutral" testID="sold" />;
  if (hit.promoted) return <Badge label={m.listing.promoted} testID="promoted" />;
  if (pct) return <Badge label={`−${pct}%`} tone="accent" testID="tile-drop" />;
  if (hit.deal) return <Badge label={m.market[hit.deal]} tone="deal" testID="tile-deal-badge" />;
  return null;
}

/** Price, with the price before a drop struck through beside it. */
function PriceLine({ hit, size = 16 }: { hit: TileListing; size?: number }) {
  const { m, locale } = useI18n();
  const theme = useTheme();
  return (
    <View style={styles.priceLine}>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.5}
        style={[styles.price, { color: theme.text, fontSize: size }]}
      >
        {formatPrice(hit.price, locale, m.common.noPrice)}
      </Text>
      {hit.priceDrop ? (
        <Text
          numberOfLines={1}
          testID="tile-reduced"
          maxFontSizeMultiplier={1.3}
          style={[styles.before, { color: theme.muted }]}
        >
          {formatPrice(hit.priceDrop.previous, locale, '')}
        </Text>
      ) : null}
    </View>
  );
}

function label(hit: TileListing, m: Messages, l: Locale) {
  return [
    hit.title,
    formatPrice(hit.price, l, m.common.noPrice),
    hit.priceDrop
      ? fill(m.market.reducedFrom, { price: formatPrice(hit.priceDrop.previous, l, '') })
      : undefined,
    hit.location.name,
    hit.sold
      ? m.listing.sold
      : hit.promoted
        ? m.listing.promoted
        : hit.deal
          ? m.market[hit.deal]
          : undefined,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Meta line under the title: place and age ("Oslo · 2 h"). */
function Meta({ hit }: { hit: TileListing }) {
  const { locale } = useI18n();
  const theme = useTheme();
  return (
    <Text numberOfLines={1} style={[styles.place, { color: theme.muted }]}>
      {hit.location.name}
      {hit.publishedAt ? ` · ${formatAge(hit.publishedAt, locale)}` : ''}
    </Text>
  );
}

/**
 * Square card for two-column grids (ADR-0048): the photo carries a corner badge and the heart; price
 * (with the old one struck through), title and "place · age" sit below, as on FINN, so prices line
 * up across a row and read at a glance.
 */
export function ListingTile({ hit, heart = true }: { hit: TileListing; heart?: boolean }) {
  const { m, locale } = useI18n();
  const theme = useTheme();
  return (
    <View style={styles.tile}>
      <Link href={`/listings/${hit.id}`} asChild>
        <Pressable
          testID="listing-card"
          role="link"
          aria-label={label(hit, m, locale)}
          style={styles.tileLink}
        >
          <View style={styles.tilePhoto}>
            <Photo hit={hit} style={styles.fill} />
            <View style={styles.badgeSpot}>
              <CornerBadge hit={hit} />
            </View>
            {hit.imageCount && hit.imageCount > 1 ? (
              <View style={styles.count}>
                <Icon name="images-outline" size={12} color="#ffffff" />
                <Text style={styles.countText}>{hit.imageCount}</Text>
              </View>
            ) : null}
          </View>
          <PriceLine hit={hit} />
          <Text numberOfLines={2} style={[styles.tileTitle, { color: theme.text }]}>
            {hit.title}
          </Text>
          <Meta hit={hit} />
        </Pressable>
      </Link>
      {heart && !hit.sold ? (
        <View style={styles.heartSpot}>
          <HeartButton id={hit.id} />
        </View>
      ) : null}
    </View>
  );
}

/** A full-width row for the search list view: a photo on the left, the details beside it. */
export function ListingRow({ hit }: { hit: TileListing }) {
  const { m, locale } = useI18n();
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <Link href={`/listings/${hit.id}`} asChild>
        <Pressable
          testID="listing-card"
          role="link"
          aria-label={label(hit, m, locale)}
          style={styles.rowLink}
        >
          <View style={styles.rowPhoto}>
            <Photo hit={hit} style={styles.fill} />
          </View>
          <View style={styles.rowText}>
            <View style={styles.rowBadge}>
              <CornerBadge hit={hit} />
            </View>
            <Text numberOfLines={2} style={[styles.rowTitle, { color: theme.text }]}>
              {hit.title}
            </Text>
            <PriceLine hit={hit} size={17} />
            <Meta hit={hit} />
          </View>
        </Pressable>
      </Link>
      {!hit.sold ? (
        <View style={styles.rowHeart}>
          <HeartButton id={hit.id} size={32} />
        </View>
      ) : null}
    </View>
  );
}

/** Wide card for the promoted carousel: photo with a glass strip carrying title and price. */
export function ListingFeature({ hit }: { hit: SearchHit }) {
  const { m, locale } = useI18n();
  const theme = useTheme();
  return (
    <View style={styles.feature}>
      <Link href={`/listings/${hit.id}`} asChild>
        <Pressable
          testID="listing-feature"
          role="link"
          aria-label={[
            hit.title,
            formatPrice(hit.price, locale, m.common.noPrice),
            m.listing.promoted,
          ].join(', ')}
          style={styles.fill}
        >
          <Photo hit={hit} style={styles.fill} />
          <View style={styles.badgeSpot}>
            <Badge label={m.listing.promoted} />
          </View>
          <Glass style={styles.strip}>
            <Text numberOfLines={1} style={[styles.stripTitle, { color: theme.text }]}>
              {hit.title}
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={[styles.price, { color: theme.text }]}>
              {formatPrice(hit.price, locale, m.common.noPrice)}
            </Text>
          </Glass>
        </Pressable>
      </Link>
      <View style={styles.heartSpot}>
        <HeartButton id={hit.id} />
      </View>
    </View>
  );
}

/** A grey stand-in for a card while the first page loads. */
export function TileSkeleton() {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const block = { backgroundColor: theme.placeholder };
  return (
    <Animated.View
      testID="tile-skeleton"
      aria-hidden
      style={[styles.tile, { opacity: pulse }]}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.tilePhoto, block]} />
      <View style={[styles.bar, block, { width: '45%' }]} />
      <View style={[styles.bar, block, { width: '85%' }]} />
      <View style={[styles.bar, block, { width: '60%' }]} />
    </Animated.View>
  );
}

const HEART = '#f43f5e';

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tile: { flex: 1 },
  tileLink: { gap: 4 },
  tilePhoto: {
    aspectRatio: 1,
    borderRadius: radius.lg - 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  badgeSpot: { position: 'absolute', top: space.sm, left: space.sm },
  heartSpot: { position: 'absolute', top: space.sm - 2, right: space.sm - 2 },
  heart: { alignItems: 'center', justifyContent: 'center' },
  count: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
    // A dark scrim reads on any photo, light or dark, in either theme.
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  countText: {
    color: '#ffffff',
    fontFamily: fonts.semibold,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  price: { fontFamily: fonts.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  before: {
    fontFamily: fonts.medium,
    fontSize: 13,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  tileTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  place: { fontFamily: fonts.body, fontSize: 12.5 },
  row: {
    flexDirection: 'row',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLink: { flex: 1, flexDirection: 'row', gap: space.md },
  rowPhoto: { width: 116, height: 116, borderRadius: radius.md, overflow: 'hidden' },
  rowText: { flex: 1, gap: 4, paddingRight: 40 },
  rowBadge: { minHeight: 0 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  rowHeart: { position: 'absolute', top: space.md, right: 0 },
  feature: { width: 270, height: 196, borderRadius: radius.xl - 4, overflow: 'hidden' },
  strip: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  stripTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  bar: { height: 12, borderRadius: 6, marginTop: 4 },
});
