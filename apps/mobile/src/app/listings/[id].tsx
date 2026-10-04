import { Icon, type IconName } from '../../components/icon';
import { COUNTIES, type County } from '@raadi/catalog/places';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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
import { ContactCompose } from '../../components/contact-compose';
import { ReportListing } from '../../components/report-listing';
import { Badge, Body, Button, Glass, liquidGlass, Status } from '../../components/ui';
import { useI18n } from '../../i18n';
import { unwrap, useApi, useLoad } from '../../lib/api';
import { attributeRows } from '../../lib/attributes';
import { useFavourite } from '../../lib/saved';
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
  const barBottom = Math.max(insets.bottom, space.md);
  // The contact form lives in the bottom bar: lift it above the keyboard while typing.
  const keyboardLift = useKeyboardLift(barBottom);
  const listing = useLoad(
    async () =>
      unwrap(await api.listings.GET('/api/v1/listings/{id}', { params: { path: { id } } })),
    [api, id],
  );
  const seller = useLoad(
    async () =>
      unwrap(
        await api.trust.GET('/api/v1/trust/listings/{id}/seller', { params: { path: { id } } }),
      ),
    [api, id],
  );

  const favourite = useFavourite(id);

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

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {nativeBar(item)}
      <ScrollView testID="listing" contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
        <View style={{ height: photoHeight, backgroundColor: theme.placeholder }}>
          {item.images.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onScroll}
              onScroll={onScroll}
              scrollEventThrottle={64}
            >
              {item.images.map((image) => (
                <Image
                  key={image.id}
                  source={{ uri: absoluteUrl(image.urls.large, config.apiBaseUrl) }}
                  style={{ width: pageWidth, height: photoHeight }}
                  contentFit="cover"
                  transition={150}
                />
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
            {formatPrice(item.priceNok, locale, m.common.noPrice)}
          </Text>
          <View style={styles.place}>
            <Icon name="location-outline" size={16} color={theme.muted} />
            <Body muted style={styles.small}>
              {item.location.name},{' '}
              {COUNTIES[item.location.county as County] ?? item.location.county} ·{' '}
              {formatAge(item.publishedAt, locale)}
            </Body>
          </View>

          <Pressable
            testID="seller"
            role="link"
            aria-label={`${m.profile.seeProfile}: ${seller.data?.name ?? item.seller.name}`}
            disabled={!seller.data}
            onPress={() => seller.data && router.push(`/users/${seller.data.userId}`)}
            style={[styles.seller, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <View style={[styles.avatar, { backgroundColor: theme.placeholder }]}>
              <Text style={[styles.avatarText, { color: theme.text }]}>
                {(seller.data?.name ?? item.seller.name).slice(0, 1)}
              </Text>
            </View>
            <View style={styles.grow}>
              <Text style={[styles.sellerName, { color: theme.text }]}>
                {seller.data?.name ?? item.seller.name}
              </Text>
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

          <Body>{item.description}</Body>
          {item.viewer?.isOwner ? (
            <Badge label={m.listing.yours} tone="neutral" testID="own-listing" />
          ) : (
            <ReportListing listingId={item.id} />
          )}
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
            )}
          </Glass>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
