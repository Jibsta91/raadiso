import type { SearchHit } from '@raadi/api-client';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n';
import { config } from '../lib/config';
import { formatPrice } from '../lib/format';
import { absoluteUrl } from '../lib/urls';
import { NoPhoto } from './no-photo';
import { fonts, radius, space, useTheme } from '../theme';
import { Badge, Glass } from './ui';

// On the web, expo-image and a Pressable inside `Link asChild` hand styles to the DOM: always pass
// one style object there, never an array (an array arrives as {0: …} and React DOM throws).

/** What a tile shows: a search hit, or a favourite (which may be sold). */
export type TileListing = Pick<SearchHit, 'id' | 'title' | 'price' | 'category' | 'image'> & {
  location: { name: string };
  promoted?: boolean;
  sold?: boolean;
};

function Photo({ hit, style }: { hit: TileListing; style: object }) {
  const theme = useTheme();
  return hit.image ? (
    <Image
      source={{ uri: absoluteUrl(hit.image.card, config.apiBaseUrl) }}
      style={{ ...style, backgroundColor: theme.placeholder }}
      contentFit="cover"
      transition={150}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <NoPhoto category={hit.category} size={36} style={style} />
  );
}

/** Square tile for two-column grids: photo with a glass price chip, title below. */
export function ListingTile({ hit }: { hit: TileListing }) {
  const { m, locale } = useI18n();
  const theme = useTheme();
  return (
    <Link href={`/listings/${hit.id}`} asChild>
      <Pressable
        testID="listing-card"
        role="link"
        aria-label={[
          hit.title,
          formatPrice(hit.price, locale, m.common.noPrice),
          hit.location.name,
          hit.sold ? m.listing.sold : hit.promoted ? m.listing.promoted : undefined,
        ]
          .filter(Boolean)
          .join(', ')}
        style={styles.tile}
      >
        <View style={styles.tilePhoto}>
          <Photo hit={hit} style={styles.fill} />
          {hit.sold ? (
            <View style={styles.badgeSpot}>
              <Badge label={m.listing.sold} tone="neutral" testID="sold" />
            </View>
          ) : hit.promoted ? (
            <View style={styles.badgeSpot}>
              <Badge label={m.listing.promoted} testID="promoted" />
            </View>
          ) : null}
          <Glass style={styles.priceChip}>
            <Text maxFontSizeMultiplier={1.5} style={[styles.price, { color: theme.text }]}>
              {formatPrice(hit.price, locale, m.common.noPrice)}
            </Text>
          </Glass>
        </View>
        <Text numberOfLines={2} style={[styles.tileTitle, { color: theme.text }]}>
          {hit.title}
        </Text>
        <Text numberOfLines={1} style={[styles.place, { color: theme.muted }]}>
          {hit.location.name}
        </Text>
      </Pressable>
    </Link>
  );
}

/** Wide card for the promoted carousel: photo with a glass strip carrying title and price. */
export function ListingFeature({ hit }: { hit: SearchHit }) {
  const { m, locale } = useI18n();
  const theme = useTheme();
  return (
    <Link href={`/listings/${hit.id}`} asChild>
      <Pressable
        testID="listing-feature"
        role="link"
        aria-label={[
          hit.title,
          formatPrice(hit.price, locale, m.common.noPrice),
          m.listing.promoted,
        ].join(', ')}
        style={styles.feature}
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
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tile: { flex: 1, gap: 6 },
  tilePhoto: { aspectRatio: 1, borderRadius: radius.lg - 2, overflow: 'hidden' },
  badgeSpot: { position: 'absolute', top: space.sm + 2, left: space.sm + 2 },
  priceChip: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  price: { fontFamily: fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  tileTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  place: { fontFamily: fonts.body, fontSize: 13, marginTop: -2 },
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
});
