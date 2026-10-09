import { ALL_ATTRIBUTES, priceUnitOf, regionName } from '@raadi/catalog';
import { toMajor } from '@raadi/catalog/money';
import { Badge } from '@raadi/ui';
import { MapPin, User } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ImageGallery } from '@/components/listings/image-gallery';
import { ListingActions } from '@/components/listings/listing-actions';
import { ListingCard } from '@/components/listings/listing-card';
import { RecordSeen } from '@/components/listings/recently-viewed';
import { ViewBeacon } from '@/components/listings/view-beacon';
import { ShareButton } from '@/components/listings/share-button';
import { ContactSeller } from '@/components/messaging/contact-seller';
import { ReportListing } from '@/components/moderation/report-listing';
import { FavouriteButton } from '@/components/saved/favourite-button';
import { nonceFrom } from '@/lib/csp';
import { SellerTrust } from '@/components/trust/seller-trust';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { favouriteIds, getListing, priceInsight, priceHistory, similarListings } from '@/lib/api';
import { env } from '@/lib/env';
import { PriceInsight } from '@/components/listings/price-insight';
import { formatPrice } from '@/lib/format';
import { jsonLd, localeAlternates, summary } from '@/lib/seo';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Attributes whose values are option keys with translated labels (from the taxonomy). */
const ENUM_ATTRIBUTES = new Set(
  [...ALL_ATTRIBUTES.values()].filter((a) => a.kind === 'select').map((a) => a.key),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const listing = UUID.test(id) ? await getListing(id) : null;
  if (!listing) return { title: 'Raadiso' };
  const description = summary(listing.description);
  const image = listing.images[0]?.urls.large;
  return {
    title: listing.title,
    description,
    alternates: localeAlternates(routing, locale, `/listings/${listing.id}`),
    openGraph: {
      title: listing.title,
      description,
      url: `/${locale}/listings/${listing.id}`,
      ...(image ? { images: [{ url: image, alt: listing.title }] } : {}),
    },
    // Removed and sold listings stay reachable by link but leave search engines.
    ...(listing.status === 'active' ? {} : { robots: { index: false } }),
  };
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID.test(id)) notFound();
  const listing = await getListing(id);
  if (!listing) notFound();
  const [t, format, session, favourites, insight, history, similar] = await Promise.all([
    getTranslations(),
    getFormatter(),
    getSession(),
    favouriteIds(),
    listing.price && listing.status === 'active' ? priceInsight(listing.id) : null,
    priceHistory(listing.id),
    listing.status === 'active' ? similarListings(listing.id) : [],
  ]);
  const canContact = listing.status === 'active' && !listing.viewer?.isOwner;

  const attributeValue = (key: string, value: string | number | boolean) => {
    if (ENUM_ATTRIBUTES.has(key)) return t(`taxonomy.values.${key}.${value}` as never);
    const def = ALL_ATTRIBUTES.get(key);
    if (def?.kind === 'number' && key !== 'year')
      return `${format.number(Number(value))}${def.unit ? ` ${def.unit}` : ''}`;
    return String(value);
  };

  const unit = priceUnitOf(listing.category, listing.subcategory);

  // What search engines show as a product with a price (schema.org Product and Offer).
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: summary(listing.description, 500),
    image: listing.images.map((img) => new URL(img.urls.large, env.publicBaseUrl).href),
    ...(listing.price === null
      ? {}
      : {
          offers: {
            '@type': 'Offer',
            price: toMajor(listing.price.amountMinor, listing.price.currency),
            priceCurrency: listing.price.currency,
            availability:
              listing.status === 'active'
                ? 'https://schema.org/InStock'
                : 'https://schema.org/SoldOut',
            url: new URL(`/${locale}/listings/${listing.id}`, env.publicBaseUrl).href,
          },
        }),
  };

  return (
    <article className="space-y-6" data-testid="listing-detail">
      <script
        type="application/ld+json"
        nonce={nonceFrom((await headers()).get('content-security-policy'))}
        dangerouslySetInnerHTML={{ __html: jsonLd(structured) }}
      />
      <nav className="text-sm text-muted-foreground" aria-label={t('nav.breadcrumb')}>
        <Link
          href={`/${listing.category}`}
          className="hover:underline"
          data-testid="crumb-category"
        >
          {t(`taxonomy.categories.${listing.category}` as never)}
        </Link>
        {' / '}
        <Link
          href={`/search?category=${listing.category}&subcategory=${listing.subcategory}`}
          className="hover:underline"
        >
          {t(`taxonomy.subcategories.${listing.subcategory}` as never)}
        </Link>
      </nav>
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[1fr_22rem] lg:grid-rows-[auto_1fr]">
        {/* Title and price come first, so phones and screen readers get them before the photos. */}
        <header className="space-y-2 lg:col-start-2 lg:row-start-1">
          {listing.status === 'sold' ? (
            <Badge variant="secondary">{t('listing.sold')}</Badge>
          ) : null}
          {listing.promotedUntil && listing.status === 'active' ? (
            <Badge variant="highlight" data-testid="listing-promoted">
              {t('listing.promotedUntil', {
                date: format.dateTime(new Date(listing.promotedUntil), { dateStyle: 'medium' }),
              })}
            </Badge>
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold" data-testid="listing-title">
              {listing.title}
            </h1>
            {listing.viewer?.isOwner || listing.status === 'deleted' ? null : (
              <FavouriteButton
                listingId={listing.id}
                title={listing.title}
                initial={favourites.has(listing.id)}
                variant="inline"
              />
            )}
          </div>
          <p className="text-3xl font-bold" data-testid="listing-price">
            {listing.price === null ? t('listing.noPrice') : formatPrice(listing.price, locale)}
            {listing.price && unit ? (
              <span className="text-base font-normal text-muted-foreground">
                {' '}
                {t(`listing.per.${unit}`)}
              </span>
            ) : null}
          </p>
          {listing.priceDrop ? (
            <p className="text-sm font-medium text-primary" data-testid="listing-reduced">
              {t.rich('price.reducedOn', {
                price: formatPrice(listing.priceDrop.previous, locale),
                date: format.dateTime(new Date(listing.priceDrop.at), { dateStyle: 'medium' }),
                old: (chunks) => <s>{chunks}</s>,
              })}
            </p>
          ) : null}
          <ShareButton title={listing.title} />
        </header>
        <div className="space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <ImageGallery images={listing.images} title={listing.title} />
          <section aria-labelledby="desc" className="space-y-2">
            <h2 id="desc" className="text-lg font-semibold">
              {t('listing.description')}
            </h2>
            <p className="whitespace-pre-line" data-testid="listing-description">
              {listing.description}
            </p>
          </section>
          {Object.keys(listing.attributes).length > 0 ? (
            <section aria-labelledby="details" className="space-y-2">
              <h2 id="details" className="text-lg font-semibold">
                {t('listing.details')}
              </h2>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                {Object.entries(listing.attributes).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">
                      {t(`taxonomy.attributes.${key}` as never)}
                    </dt>
                    <dd>{attributeValue(key, value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4 lg:col-start-2 lg:row-start-2">
          {insight ? <PriceInsight insight={insight} /> : null}
          {history.length > 1 ? (
            <details className="rounded-2xl border p-4 text-sm" data-testid="price-history">
              <summary className="cursor-pointer font-semibold">{t('price.history')}</summary>
              <table className="mt-3 w-full">
                <caption className="sr-only">{t('price.historyCaption')}</caption>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.at} className="border-t first:border-t-0">
                      <td className="py-1.5 text-muted-foreground">
                        {format.dateTime(new Date(h.at), { dateStyle: 'medium' })}
                      </td>
                      <td className="py-1.5 text-end font-medium tabular-nums">
                        {h.amountMinor === null || !h.currency
                          ? t('price.noPrice')
                          : formatPrice(
                              { amountMinor: h.amountMinor, currency: h.currency },
                              locale,
                            )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
          <div className="space-y-3 rounded-lg border p-4 text-sm">
            <dl className="space-y-3">
              <div className="flex items-start gap-2">
                <dt className="mt-0.5">
                  <MapPin aria-hidden className="size-4 text-muted-foreground" />
                  <span className="sr-only">{t('listing.location')}</span>
                </dt>
                <dd>
                  {listing.location.name}, {regionName(listing.location.region)}
                </dd>
              </div>
              <div className="flex items-start gap-2">
                <dt className="mt-0.5">
                  <User aria-hidden className="size-4 text-muted-foreground" />
                  <span className="sr-only">{t('listing.seller')}</span>
                </dt>
                <dd className="space-y-1">
                  <span data-testid="listing-seller">{listing.seller.name}</span>
                  <SellerTrust listingId={listing.id} />
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {t('listing.published', {
                date: format.dateTime(new Date(listing.publishedAt), { dateStyle: 'medium' }),
              })}
            </p>
          </div>
          <ListingActions listing={listing} />
          {listing.stats ? (
            <p className="text-sm text-muted-foreground" data-testid="listing-views">
              {t('my.views', { count: listing.stats.views })}
            </p>
          ) : null}
          {canContact && session.authenticated ? <ContactSeller listingId={listing.id} /> : null}
          {canContact && !session.authenticated ? (
            <a
              href={`/auth/login?returnTo=${encodeURIComponent(`/${locale}/listings/${listing.id}`)}&locale=${locale}`}
              className="block rounded-lg border p-4 text-center text-sm font-medium text-primary hover:bg-accent"
              data-testid="contact-login"
            >
              {t('messages.contact.login')}
            </a>
          ) : null}
          {listing.status !== 'deleted' && !listing.viewer?.isOwner ? (
            <ReportListing listingId={listing.id} />
          ) : null}
          {listing.status === 'active' && !listing.viewer?.isOwner ? (
            <ViewBeacon id={listing.id} />
          ) : null}
        </aside>
      </div>
      {listing.status === 'active' && !listing.viewer?.isOwner ? (
        <RecordSeen
          listing={{
            id: listing.id,
            title: listing.title,
            price: listing.price,
            ...(listing.images[0] ? { image: listing.images[0].urls.thumb } : {}),
            place: listing.location.name,
          }}
        />
      ) : null}
      {similar.length ? (
        <section
          aria-labelledby="similar"
          className="mt-14 space-y-5"
          data-testid="similar-listings"
        >
          <h2 id="similar" className="text-2xl font-bold">
            {t('listing.similarTitle')}
          </h2>
          <ul
            className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 lg:grid-cols-4"
            role="list"
          >
            {similar.slice(0, 8).map((hit) => (
              <li key={hit.id} className="flex">
                <ListingCard hit={hit} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
