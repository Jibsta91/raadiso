import type { SearchHit } from '@raadi/api-client';
import type { Category } from '@raadi/catalog';
import { ImageOff } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { FavouriteButton } from '@/components/saved/favourite-button';
import { Link } from '@/i18n/navigation';
import { favouriteIds } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { CATEGORY_ICONS } from '@/lib/taxonomy-icons';

/** What a card shows: a search hit, or a favourite (which may be sold). */
export type CardListing = Pick<SearchHit, 'id' | 'title' | 'price' | 'category' | 'image'> & {
  location: { name: string };
  promoted?: boolean;
  distanceKm?: number;
  /** A good price against comparable listings (ADR-0043). */
  deal?: 'great' | 'good';
  /** A recent price drop (ADR-0044). */
  priceDrop?: { previous: { amountMinor: number; currency: string }; at: string };
  sold?: boolean;
};

/**
 * A result tile: photo with a glass price chip and a heart, then title and place (and distance
 * near a place). The heart sits beside the link, never inside it (no buttons inside links).
 */
export async function ListingCard({ hit }: { hit: CardListing }) {
  const [t, locale, favourites] = await Promise.all([
    getTranslations(),
    getLocale(),
    favouriteIds(),
  ]);
  const NoPhoto = CATEGORY_ICONS[hit.category as Category] ?? ImageOff;
  return (
    <div className="relative flex w-full">
      <FavouriteButton listingId={hit.id} title={hit.title} initial={favourites.has(hit.id)} />
      <Link
        href={`/listings/${hit.id}`}
        className="group flex w-full flex-col gap-2.5 rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        data-testid="listing-card"
      >
        <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-placeholder">
          {hit.image ? (
            /* Plain <img>: imgproxy already serves sized, signed variants. */
            <img
              src={hit.image.card}
              srcSet={`${hit.image.thumb} 320w, ${hit.image.card} 640w`}
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <NoPhoto
              aria-hidden
              strokeWidth={1.5}
              className="absolute inset-0 m-auto size-10 text-muted-foreground"
            />
          )}
          {hit.sold ? (
            <span
              className="absolute start-3 top-3 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-ink-foreground"
              data-testid="listing-card-sold"
            >
              {t('listing.sold')}
            </span>
          ) : hit.promoted ? (
            <span
              className="absolute start-3 top-3 rounded-full bg-highlight px-2.5 py-1 text-xs font-bold text-highlight-foreground"
              data-testid="listing-card-promoted"
            >
              {t('listing.promoted')}
            </span>
          ) : null}
          <p
            className="glass absolute bottom-2.5 start-2.5 rounded-full px-3 py-1 text-sm font-bold tabular-nums sm:bottom-3 sm:start-3 sm:py-1.5 sm:text-base"
            data-testid="listing-card-price"
          >
            {hit.price === null ? t('listing.noPrice') : formatPrice(hit.price, locale)}
          </p>
        </div>
        <div className="flex flex-col gap-0.5 px-1">
          <h3
            className="line-clamp-2 text-[15px] font-semibold leading-snug sm:text-[17px]"
            data-testid="listing-card-title"
          >
            {hit.title}
          </h3>
          <p className="text-sm text-muted-foreground" data-testid="listing-card-location">
            {hit.location.name}
            {hit.distanceKm !== undefined
              ? ` · ${t('search.distance', { km: Math.round(hit.distanceKm) })}`
              : ''}
          </p>
          {hit.priceDrop ? (
            <p className="text-sm font-medium text-primary" data-testid="listing-card-reduced">
              {t.rich('price.reducedFrom', {
                price: formatPrice(hit.priceDrop.previous, locale),
                old: (chunks) => <s>{chunks}</s>,
              })}
            </p>
          ) : null}
          {hit.deal ? (
            <p
              className="text-sm font-semibold text-primary"
              data-testid="listing-card-deal"
              data-deal={hit.deal}
            >
              {t(`price.deal.${hit.deal}`)}
            </p>
          ) : null}
        </div>
      </Link>
    </div>
  );
}

export function ListingGrid({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 lg:grid-cols-4"
      role="list"
    >
      {children}
    </ul>
  );
}
