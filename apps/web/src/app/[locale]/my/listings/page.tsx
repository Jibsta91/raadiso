import { Badge, Button } from '@raadi/ui';
import { Image as ImageIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { RenewButton } from '@/components/listings/renew-button';
import { Link } from '@/i18n/navigation';
import { myListings } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('my');
  return { title: t('title'), robots: { index: false } };
}

export default async function MyListingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/my/listings`)}&locale=${locale}`,
    );
  }
  const [t, page, current] = await Promise.all([
    getTranslations(),
    myListings(50, 0, true),
    getLocale(),
  ]);
  const items = page?.items ?? [];

  /** Photo, title, price and place, and the status (with why, if a moderator removed it). */
  const content = (l: (typeof items)[number]) => (
    <>
      {/* A removed listing's photos are deleted soon after, so it shows the placeholder. */}
      {l.images[0] && !l.removal ? (
        <img src={l.images[0].urls.thumb} alt="" className="h-16 w-20 rounded-xl object-cover" />
      ) : (
        <div className="flex h-16 w-20 items-center justify-center rounded-xl bg-placeholder">
          <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1">
        <p className="font-medium">{l.title}</p>
        <p className="text-sm text-muted-foreground">
          {l.price === null ? t('listing.noPrice') : formatPrice(l.price, current)} ·{' '}
          {l.location.name}
        </p>
        {l.stats && !l.removal ? (
          <p className="text-xs text-muted-foreground" data-testid="my-listing-views">
            {t('my.views', { count: l.stats.views })}
            {l.stats.favourites !== undefined ? (
              <span data-testid="my-listing-favourites">
                {' · '}
                {t('my.favourites', { count: l.stats.favourites })}
              </span>
            ) : null}
          </p>
        ) : null}
        {l.removal ? (
          <p className="text-sm" data-testid="my-listing-removal">
            {t('my.removedBecause', {
              reason: t(`my.removalReasons.${l.removal.reason ?? 'other'}`),
            })}
          </p>
        ) : null}
      </div>
      {l.removal ? (
        <Badge variant="destructive" data-testid="my-listing-removed">
          {t('my.status.removed')}
        </Badge>
      ) : (
        <Badge variant={l.status === 'sold' ? 'secondary' : 'success'}>
          {t(`my.status.${l.status === 'sold' ? 'sold' : 'active'}`)}
        </Badge>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('my.title')}</h1>
        <Button asChild>
          <Link href="/listings/new">{t('nav.newListing')}</Link>
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="space-y-3 py-12 text-center">
          <p className="text-muted-foreground">{t('my.empty')}</p>
          <Button asChild variant="outline">
            <Link href="/listings/new">{t('my.create')}</Link>
          </Button>
        </div>
      ) : (
        <ul
          className="divide-y overflow-hidden rounded-3xl border bg-card"
          role="list"
          data-testid="my-listings"
        >
          {items.map((l) => (
            <li key={l.id} className="flex items-center gap-2 pe-3">
              {/* A removed listing has no page any more: it shows here, with why, but links nowhere. */}
              {l.removal ? (
                <div className="flex flex-1 items-center gap-4 p-3 opacity-90">{content(l)}</div>
              ) : (
                <Link
                  href={`/listings/${l.id}`}
                  className="flex flex-1 items-center gap-4 p-3 hover:bg-accent"
                >
                  {content(l)}
                </Link>
              )}
              {/* Beside the link, never inside it (no buttons inside links). */}
              {l.status === 'active' && !l.removal && l.stats ? (
                <RenewButton id={l.id} renewableAt={l.stats.renewableAt} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
