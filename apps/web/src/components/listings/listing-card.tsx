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

/** The grids listings appear in; `sizes` says how wide a photo is at each breakpoint. */
const GRIDS = {
  // 2 columns on phones, 3 from md, 4 from lg (the page is at most 80rem wide).
  page: {
    className: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    sizes: '(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw',
  },
  // Beside the search filters: 2 columns, 3 from lg.
  sidebar: {
    className: 'grid-cols-2 lg:grid-cols-3',
    sizes: '(min-width: 1280px) 320px, (min-width: 1024px) 25vw, (min-width: 768px) 30vw, 50vw',
  },
} as const;
export type GridLayout = keyof typeof GRIDS;

/**
 * A result tile: photo with a glass price chip and a heart, then title and place (and distance
 * near a place). The heart sits beside the link, never inside it (no buttons inside links). A
 * `priority` card (the first ones above the fold) loads its photo at once; the rest load lazily.
 */
export async function ListingCard({
  hit,
  priority = false,
  sizes = GRIDS.page.sizes,
}: {
  hit: CardListing;
  priority?: boolean;
  sizes?: string;
}) {
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
        className="group focus-ring flex w-full flex-col gap-2.5 rounded-card"
        data-testid="listing-card"
      >
        <div className="relative aspect-[4/3] overflow-hidden rounded-card border bg-placeholder motion-safe:transition-shadow group-hover:shadow-2">
          {hit.image ? (
            /* Plain <img>: imgproxy already serves sized, signed variants. */
            <img
              src={hit.image.card}
              srcSet={`${hit.image.thumb} 320w, ${hit.image.card} 640w`}
              sizes={sizes}
              width={640}
              height={480}
              alt=""
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              decoding="async"
              className="size-full object-cover motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-[1.03]"
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
              className="absolute start-3 top-3 rounded-full bg-inverse px-2.5 py-1 text-xs font-bold text-inverse-foreground"
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
            className="glass price absolute bottom-2.5 start-2.5 rounded-full px-3 py-1 text-sm sm:bottom-3 sm:start-3 sm:py-1.5 sm:text-base"
            data-testid="listing-card-price"
          >
            {hit.price === null ? t('listing.noPrice') : formatPrice(hit.price, locale)}
          </p>
        </div>
        <div className="flex flex-col gap-0.5 px-1">
          <h3
            className="line-clamp-2 text-base font-semibold leading-snug sm:text-lg"
            data-testid="listing-card-title"
          >
            {hit.title}
          </h3>
          <p className="text-meta text-muted-foreground" data-testid="listing-card-location">
            {hit.location.name}
            {hit.distanceKm !== undefined
              ? ` · ${t('search.distance', { km: Math.round(hit.distanceKm) })}`
              : ''}
          </p>
          {hit.priceDrop ? (
            <p className="text-meta font-medium text-success" data-testid="listing-card-reduced">
              {t.rich('price.reducedFrom', {
                price: formatPrice(hit.priceDrop.previous, locale),
                old: (chunks) => <s>{chunks}</s>,
              })}
            </p>
          ) : null}
          {hit.deal ? (
            <p
              className="text-meta font-semibold text-success"
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

/**
 * Listings as a grid of cards: 2 columns on phones, 3 from md and 4 from lg (`sidebar`: 2, then 3
 * beside the search filters). With `priority`, the first two photos load at once (above the fold).
 */
export function ListingGrid({
  items,
  layout = 'page',
  priority = false,
  testId,
}: {
  items: CardListing[];
  layout?: GridLayout;
  priority?: boolean;
  testId?: string;
}) {
  const grid = GRIDS[layout];
  return (
    <ul
      className={`grid gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 ${grid.className}`}
      role="list"
      data-testid={testId}
    >
      {items.map((hit, i) => (
        <li key={hit.id} className="flex">
          <ListingCard hit={hit} priority={priority && i < 2} sizes={grid.sizes} />
        </li>
      ))}
    </ul>
  );
}
