import { Alert, Button } from '@raadi/ui';
import { Heart } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingGrid } from '@/components/listings/listing-card';
import { Link } from '@/i18n/navigation';
import { favourites, ServiceUnavailableError } from '@/lib/api';
import { getSession } from '@/lib/session';
import { ClientMessages } from '@/components/client-messages';

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
    return <Alert variant="danger">{t('unavailable')}</Alert>;
  }
  const items = page?.items ?? [];

  return (
    <ClientMessages set="favourites">
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
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
          <ListingGrid
            testId="favourites"
            priority
            items={items.map((f) => ({
              id: f.listing.id,
              title: f.listing.title,
              price: f.listing.price,
              category: f.listing.category,
              image: f.listing.image,
              location: f.listing.location,
              sold: f.listing.status === 'sold',
            }))}
          />
        )}
      </div>
    </ClientMessages>
  );
}
