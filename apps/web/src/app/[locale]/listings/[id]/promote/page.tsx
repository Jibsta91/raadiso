import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { PromoteForm } from '@/components/payments/promote-form';
import { Link } from '@/i18n/navigation';
import { getListing, paymentProducts } from '@/lib/api';
import { getSession } from '@/lib/session';
import { ClientMessages } from '@/components/client-messages';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('payments');
  return { title: t('title'), robots: { index: false } };
}

/** Buy a promotion for one of your active listings. */
export default async function PromotePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/listings/${id}/promote`)}&locale=${locale}`,
    );
  }
  if (!UUID.test(id)) notFound();
  const [t, format, listing, products] = await Promise.all([
    getTranslations('payments'),
    getFormatter(),
    getListing(id),
    paymentProducts(),
  ]);
  if (!listing || !listing.viewer?.isOwner || listing.status !== 'active') notFound();

  return (
    <ClientMessages set="promote">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href={`/listings/${id}`} className="text-sm text-primary hover:underline">
          ← {listing.title}
        </Link>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
          {listing.promotedUntil ? (
            <p className="text-sm" data-testid="promote-current">
              {t('currentlyUntil', {
                date: format.dateTime(new Date(listing.promotedUntil), { dateStyle: 'long' }),
              })}
            </p>
          ) : null}
        </div>
        {products.length ? (
          <PromoteForm listingId={id} products={products} />
        ) : (
          // No payment provider yet (PAYMENTS_PROVIDER=none, ADR-0051).
          <p
            className="rounded-card border p-4 text-muted-foreground"
            data-testid="promote-unavailable"
          >
            {t('unavailable')}
          </p>
        )}
      </div>
    </ClientMessages>
  );
}
