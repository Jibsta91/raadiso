import { Icon, type IconName } from '../../components/icon';
import { regionName } from '@raadi/catalog/places';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoPhoto } from '../../components/no-photo';
import { PhotoViewer } from '../../components/photo-viewer';
import { ContactCompose } from '../../components/contact-compose';
import { ReportListing } from '../../components/report-listing';
import { Badge, Body, Button, Glass, liquidGlass, Status } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { ListingTile } from '../../components/listing-card';
import { unwrap, useApi, useLoad } from '../../lib/api';
import { attributeRows } from '../../lib/attributes';
import { useFavourite } from '../../lib/saved';
import { recordSeen } from '../../lib/recent';
import { useAuth } from '../../lib/auth/context';
import { isCategory, isSubcategoryOf } from '../../lib/categories';
import { useKeyboardLift } from '../../lib/keyboard';
import { config } from '../../lib/config';
import { shareListing } from '../../lib/share';
import { formatAge, formatPrice, intlLocale } from '../../lib/format';
import { absoluteUrl } from '../../lib/urls';
import { fonts, radius, space, useTheme } from '../../theme';

/** Round glass button over the photo. */
function GlassIcon({
  icon,
  label,
  onPress,
  color,
  pressed,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  pressed?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-pressed={pressed}
      testID={testID}
      onPress={onPress}
      hitSlop={6}
    >
      <Glass style={styles.iconButton} interactive>
        <Icon name={icon} size={20} color={color ?? theme.text} />
      </Glass>
    </Pressable>
  );
}

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { m, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [photo, setPhoto] = useState(0);
  const [composing, setComposing] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const gallery = useRef<ScrollView>(null);
  const barBottom = Math.max(insets.bottom, space.md);
  // The contact form lives in the bottom bar: lift it above the keyboard while typing.
  const keyboardLift = useKeyboardLift(barBottom);
  const listing = useLoad(
    async () =>
      unwrap(await api.listings.GET('/api/v1/listings/{id}', { params: { path: { id } } })),
    [api, id],
  );
  // Back from editing (or anywhere else): show the current version. The first focus is the load itself.
  const reloadListing = listing.reload;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reloadListing();
      focused.current = true;
    }, [reloadListing]),
  );
  const seller = useLoad(
    async () =>
      unwrap(
        await api.trust.GET('/api/v1/trust/listings/{id}/seller', { params: { path: { id } } }),
      ),
    [api, id],
  );

  // How the price compares with similar listings (ADR-0043); quietly absent if search can't say.
  const insight = useLoad(
    async () =>
      unwrap(
        await api.search.GET('/api/v1/search/listings/{id}/price-insight', {
          params: { path: { id } },
        }),
      )?.insight ?? null,
    [api, id],
  );

  const perUnit = (
    amountMinor: number,
    i: { currency: string; stats: { unit: 'listing' | 'areaM2' | 'head' } },
  ) =>
    formatPrice({ amountMinor: Math.round(amountMinor), currency: i.currency }, locale, '') +
    (i.stats.unit === 'areaM2'
      ? ` ${m.market.perArea}`
      : i.stats.unit === 'head'
        ? ` ${m.market.perHead}`
        : '');

  // Listings like this one (ADR-0047), below the listing.
  const similar = useLoad(
    async () =>
      unwrap(
        await api.search.GET('/api/v1/search/listings/{id}/similar', { params: { path: { id } } }),
      )?.items ?? [],
    [api, id],
  );

  const favourite = useFavourite(id);

  // Remembered on this device for the front page's "Recently viewed" (ADR-0048); not one's own.
  const seen = listing.data;
  useEffect(() => {
    if (!seen || seen.viewer?.isOwner || seen.status !== 'active') return;
    void recordSeen({
      id: seen.id,
      title: seen.title,
      price: seen.price,
      category: seen.category,
      location: { name: seen.location.name },
      ...(seen.images[0] ? { image: { card: seen.images[0].urls.card } } : {}),
    });
  }, [seen]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // iOS 26: the system navigation bar over the photo. Back (with the swipe), favourite and share are
  // native bar buttons with SF Symbols, which iOS draws in Liquid Glass. Elsewhere: our glass buttons.
  const nativeBar = (actions: NonNullable<typeof listing.data> | null) =>
    liquidGlass ? (
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          title: '',
          headerBackButtonDisplayMode: 'minimal',
          unstable_headerRightItems: () =>
            actions
              ? [
                  ...(actions.viewer?.isOwner
                    ? []
                    : [
                        {
                          type: 'button' as const,
                          label: favourite.saved ? m.favourites.remove : m.favourites.add,
                          icon: {
                            type: 'sfSymbol' as const,
                            name: favourite.saved ? ('heart.fill' as const) : ('heart' as const),
                          },
                          tintColor: favourite.saved ? '#f43f5e' : undefined,
                          identifier: 'favourite-toggle',
                          onPress: () => void favourite.toggle(),
                        },
                      ]),
                  {
                    type: 'button' as const,
                    label: m.common.share,
                    icon: { type: 'sfSymbol' as const, name: 'square.and.arrow.up' as const },
                    identifier: 'share',
                    onPress: () => shareListing(actions, locale),
                  },
                ]
              : [],
        }}
      />
    ) : null;

  if (listing.loading || listing.error) {
    return (
      <>
        {nativeBar(null)}
        <Status loading={listing.loading} error={listing.error} onRetry={listing.reload} />
      </>
    );
  }
  const item = listing.data;
  if (!item || item.status === 'deleted') {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + space.lg }]}>
        <GlassIcon icon="chevron-back" label={m.common.back} onPress={back} />
        <Status empty={m.listing.notFound} testID="not-found" />
      </View>
    );
  }

  const pageWidth = Math.min(width, 720);
  const photoHeight = Math.round(pageWidth * 0.95);
  const promoted = item.promotedUntil !== null && new Date(item.promotedUntil) > new Date();
  const canContact = !item.viewer?.isOwner && item.status === 'active';
  const details = attributeRows(item.attributes, m.taxonomy, intlLocale[locale]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPhoto(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  const long = item.description.length > CUT + 80;
  const photos = item.images.map((image) => ({
    id: image.id,
    large: absoluteUrl(image.urls.large, config.apiBaseUrl),
    thumb: absoluteUrl(image.urls.thumb, config.apiBaseUrl),
  }));

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {nativeBar(item)}
      <ScrollView testID="listing" contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
        <View style={{ height: photoHeight, backgroundColor: theme.placeholder }}>
          {item.images.length > 0 ? (
            <ScrollView
              ref={gallery}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onScroll}
              onScroll={onScroll}
              scrollEventThrottle={64}
            >
              {item.images.map((image, i) => (
                <Pressable
                  key={image.id}
                  role="button"
                  testID="listing-photo"
                  aria-label={fill(m.listing.photo, { n: i + 1, total: item.images.length })}
                  onPress={() => setViewer(i)}
                >
                  <Image
                    source={{ uri: absoluteUrl(image.urls.large, config.apiBaseUrl) }}
                    style={{ width: pageWidth, height: photoHeight }}
                    contentFit="cover"
                    transition={150}
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <NoPhoto category={item.category} size={64} style={{ flex: 1 }} />
          )}
          {item.images.length > 1 ? (
            <Glass style={styles.counter}>
              <Text style={[styles.counterText, { color: theme.text }]}>
                {photo + 1} / {item.images.length}
              </Text>
            </Glass>
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.badges}>
            {item.status === 'sold' ? (
              <Badge label={m.listing.sold} tone="neutral" testID="sold" />
            ) : null}
            {promoted ? <Badge label={m.listing.promoted} testID="promoted" /> : null}
          </View>
          {isCategory(item.category) && isSubcategoryOf(item.category, item.subcategory) ? (
            <Pressable
              role="link"
              testID="listing-crumb"
              onPress={() =>
                router.push({
                  pathname: '/search',
                  params: { category: item.category, subcategory: item.subcategory },
                })
              }
            >
              <Text style={[styles.crumb, { color: theme.muted }]}>
                {m.categories[item.category]} › {m.taxonomy.subcategories[item.subcategory]}
              </Text>
            </Pressable>
          ) : null}
          <Text
            role="heading"
            aria-level={1}
            testID="listing-title"
            style={[styles.title, { color: theme.text }]}
          >
            {item.title}
          </Text>
          <Text testID="listing-price" style={[styles.price, { color: theme.text }]}>
            {formatPrice(item.price, locale, m.common.noPrice)}
          </Text>
          {item.priceDrop ? (
            <Text testID="listing-reduced" style={[styles.reduced, { color: theme.accent }]}>
              {fill(m.market.reducedFrom, {
                price: formatPrice(item.priceDrop.previous, locale, ''),
              })}
            </Text>
          ) : null}
          {insight.data ? (
            <View
              testID="price-insight"
              style={[styles.insight, { borderColor: theme.border }]}
              accessible
            >
              <Text style={[styles.insightTitle, { color: theme.text }]}>
                {m.market.insight}:{' '}
                <Text
                  style={{
                    color:
                      insight.data.rating === 'unusually_low'
                        ? theme.danger
                        : insight.data.rating === 'great' || insight.data.rating === 'good'
                          ? theme.accent
                          : theme.text,
                  }}
                >
                  {m.market.rating[insight.data.rating]}
                </Text>
              </Text>
              <Body muted style={styles.small}>
                {fill(m.market.range, {
                  count: insight.data.stats.comparables,
                  from: perUnit(insight.data.stats.p25, insight.data),
                  to: perUnit(insight.data.stats.p75, insight.data),
                })}
              </Body>
              {insight.data.rating === 'unusually_low' ? (
                <Body style={styles.small}>{m.market.warning}</Body>
              ) : null}
            </View>
          ) : null}
          <View style={styles.place}>
            <Icon name="location-outline" size={16} color={theme.muted} />
            <Body muted style={styles.small}>
              {item.location.name}, {regionName(item.location.region)} ·{' '}
              {formatAge(item.publishedAt, locale)}
            </Body>
          </View>

          <Pressable
            testID="seller"
            role="link"
            aria-label={`${m.profile.seeProfile}: ${item.seller.name}`}
            disabled={!seller.data}
            onPress={() => seller.data && router.push(`/users/${seller.data.userId}`)}
            style={[styles.seller, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            {/* The name comes from the listing: trust only learns names once someone is reviewed. */}
            <View style={[styles.avatar, { backgroundColor: theme.placeholder }]}>
              <Text style={[styles.avatarText, { color: theme.text }]}>
                {item.seller.name.slice(0, 1)}
              </Text>
            </View>
            <View style={styles.grow}>
              <Text style={[styles.sellerName, { color: theme.text }]}>{item.seller.name}</Text>
              {seller.data ? (
                <View style={styles.place}>
                  <Icon
                    name={seller.data.verification ? 'shield-checkmark' : 'shield-outline'}
                    size={14}
                    color={seller.data.verification ? theme.accent : theme.muted}
                  />
                  <Body muted style={styles.small}>
                    {seller.data.verification ? m.listing.verified : m.listing.notVerified}
                    {seller.data.rating.average !== null
                      ? ` · ★ ${seller.data.rating.average.toFixed(1)} (${seller.data.rating.count})`
                      : ''}
                  </Body>
                </View>
              ) : null}
            </View>
            {seller.data ? <Icon name="chevron-forward" size={18} color={theme.muted} /> : null}
          </Pressable>

          {details.length > 0 ? (
            <View
              testID="listing-details"
              style={[
                styles.details,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.detailsTitle, { color: theme.text }]}>{m.listing.details}</Text>
              <View style={styles.detailGrid}>
                {details.map((d) => (
                  <View key={d.key} style={styles.detail}>
                    <Text style={[styles.detailLabel, { color: theme.muted }]}>{d.label}</Text>
                    <Text style={[styles.detailValue, { color: theme.text }]}>{d.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.description}>
            <Body testID="listing-description">
              {long && !expanded
                ? `${item.description.slice(0, CUT).trimEnd()}…`
                : item.description}
            </Body>
            {long ? (
              <Pressable
                role="button"
                testID="description-toggle"
                aria-expanded={expanded}
                hitSlop={8}
                onPress={() => setExpanded((e) => !e)}
              >
                <Text style={[styles.more, { color: theme.accent }]}>
                  {expanded ? m.listing.showLess : m.listing.showMore}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {item.viewer?.isOwner ? (
            <View style={styles.ownerRow}>
              <Badge label={m.listing.yours} tone="neutral" testID="own-listing" />
              {item.viewer.canEdit && item.status === 'active' ? (
                <Button
                  testID="edit-listing"
                  variant="secondary"
                  label={m.sell.edit}
                  onPress={() => router.push(`/listings/edit/${item.id}`)}
                />
              ) : null}
            </View>
          ) : (
            <ReportListing listingId={item.id} />
          )}
          {similar.data?.length ? (
            <View style={styles.similar} testID="similar-listings">
              <Text style={[styles.similarTitle, { color: theme.text }]}>{m.market.similar}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.similarRow}
              >
                {similar.data.map((hit) => (
                  <View key={hit.id} style={styles.similarTile}>
                    <ListingTile hit={hit} />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {liquidGlass ? null : (
        <View style={[styles.topBar, { top: insets.top + space.sm }]} pointerEvents="box-none">
          <GlassIcon icon="chevron-back" label={m.common.back} onPress={back} />
          <View style={styles.topActions}>
            {item.viewer?.isOwner ? null : (
              <GlassIcon
                icon={favourite.saved ? 'heart' : 'heart-outline'}
                color={favourite.saved ? '#f43f5e' : undefined}
                label={favourite.saved ? m.favourites.remove : m.favourites.add}
                pressed={favourite.saved}
                testID="favourite-toggle"
                onPress={() => void favourite.toggle()}
              />
            )}
            <GlassIcon
              icon="share-outline"
              label={m.common.share}
              onPress={() => {
                shareListing(item, locale);
              }}
            />
          </View>
        </View>
      )}

      {canContact ? (
        <Animated.View
          style={[
            styles.bottomBar,
            { bottom: barBottom, transform: [{ translateY: keyboardLift }] },
          ]}
        >
          <Glass style={styles.bottomBarGlass}>
            {composing && auth.status === 'signedIn' ? (
              <ContactCompose
                listingId={item.id}
                onCancel={() => setComposing(false)}
                onSent={(conversation) => router.push(`/messages/${conversation}`)}
              />
            ) : (
              <View style={styles.barRow}>
                <View style={styles.barPrice}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={1.3}
                    style={[styles.barPriceText, { color: theme.text }]}
                  >
                    {formatPrice(item.price, locale, m.common.noPrice)}
                  </Text>
                  {item.priceDrop ? (
                    <Text numberOfLines={1} style={[styles.barBefore, { color: theme.muted }]}>
                      {formatPrice(item.priceDrop.previous, locale, '')}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.grow}>
                  <Button
                    testID={auth.status === 'signedIn' ? 'contact-open' : 'contact-login'}
                    label={auth.status === 'signedIn' ? m.contact.title : m.contact.login}
                    icon={
                      <Icon name="chatbubble-ellipses-outline" size={20} color={theme.accentText} />
                    }
                    onPress={() => {
                      if (auth.status !== 'signedIn') return void auth.signIn();
                      // iOS: the message is written in a native sheet (grabber, half and full height);
                      // elsewhere the bottom bar turns into the form.
                      if (Platform.OS === 'ios') {
                        router.push({
                          pathname: '/contact/[listingId]',
                          params: { listingId: item.id, title: item.title },
                        });
                      } else setComposing(true);
                    }}
                  />
                </View>
              </View>
            )}
          </Glass>
        </Animated.View>
      ) : null}
      <PhotoViewer
        photos={photos}
        start={viewer}
        onClose={(last) => {
          setViewer(null);
          setPhoto(last);
          gallery.current?.scrollTo({ x: last * pageWidth, animated: false });
        }}
      />
    </View>
  );
}

/** Descriptions longer than this are cut, with "Show more". */
const CUT = 320;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  description: { gap: space.sm },
  more: { fontFamily: fonts.semibold, fontSize: 15 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  barPrice: { maxWidth: '45%', paddingLeft: space.sm },
  barPriceText: { fontFamily: fonts.bold, fontSize: 18, fontVariant: ['tabular-nums'] },
  barBefore: {
    fontFamily: fonts.medium,
    fontSize: 13,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  reduced: { fontFamily: fonts.semibold, fontSize: 15 },
  similar: { gap: space.md, marginTop: space.lg },
  similarTitle: { fontFamily: fonts.bold, fontSize: 20 },
  similarRow: { gap: space.md },
  similarTile: { width: 156 },
  insight: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  insightTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  missing: { flex: 1, paddingHorizontal: space.lg },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  counter: {
    position: 'absolute',
    bottom: 44,
    alignSelf: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  counterText: { fontFamily: fonts.semibold, fontSize: 12 },
  sheet: {
    marginTop: -radius.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl - 4,
    paddingTop: space.xl,
    gap: space.md,
  },
  badges: { flexDirection: 'row', gap: space.sm },
  crumb: { fontFamily: fonts.medium, fontSize: 13 },
  details: { gap: space.md, padding: space.lg, borderRadius: radius.lg - 2, borderWidth: 1 },
  detailsTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  detail: { width: '50%', gap: 2, paddingRight: space.sm },
  detailLabel: { fontFamily: fonts.medium, fontSize: 12 },
  detailValue: { fontFamily: fonts.semibold, fontSize: 15 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.8 },
  price: {
    fontFamily: fonts.displayHeavy,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { fontSize: 14, lineHeight: 20 },
  ownerRow: { gap: space.md, alignItems: 'flex-start' },
  seller: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md + 2,
    borderRadius: radius.lg - 2,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.bold, fontSize: 18 },
  sellerName: { fontFamily: fonts.semibold, fontSize: 16 },
  grow: { flex: 1 },
  bottomBar: { position: 'absolute', left: space.lg, right: space.lg },
  topActions: { flexDirection: 'row', gap: space.sm },
  bottomBarGlass: { borderRadius: radius.xl - 2, padding: space.sm + 2 },
  compose: { gap: space.sm + 2 },
  composeActions: { flexDirection: 'row', gap: space.sm },
});
