import { Button } from '@raadi/ui';
import { Heart } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingCard } from '@/components/listings/listing-card';
import { Link } from '@/i18n/navigation';
import { favourites, ServiceUnavailableError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('favourites');
  return { title: t('title'), robots: { index: false } };
}

/** The signed-in user's favourites (ADR-0026); sold listings stay, marked sold. */
export default async function FavouritesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/my/favourites`)}&locale=${locale}`,
    );
  }
  const t = await getTranslations('favourites');
  let page;
  try {
    page = await favourites();
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
        {t('unavailable')}
      </div>
    );
  }
  const items = page?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      {items.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 py-16 text-center"
          data-testid="favourites-empty"
        >
          <Heart aria-hidden className="size-10 text-muted-foreground" />
          <p className="max-w-sm text-muted-foreground">{t('empty')}</p>
          <Button asChild variant="outline">
            <Link href="/search">{t('browse')}</Link>
          </Button>
        </div>
      ) : (
        <ul
          className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 lg:grid-cols-4"
          role="list"
          data-testid="favourites"
        >
          {items.map((f) => (
            <li key={f.listingId} className="flex">
              <ListingCard
                hit={{
                  id: f.listing.id,
                  title: f.listing.title,
                  price: f.listing.price,
                  category: f.listing.category,
                  image: f.listing.image,
                  location: f.listing.location,
                  sold: f.listing.status === 'sold',
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
