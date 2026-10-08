import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingForm } from '@/components/listings/listing-form';
import { getListing } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('form');
  return { title: t('editTitle'), robots: { index: false } };
}

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/listings/${id}/edit`)}&locale=${locale}`,
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const listing = await getListing(id);
  // The API decides who may edit (OpenFGA); everyone else gets a 404 here.
  if (!listing?.viewer?.canEdit) notFound();
  const t = await getTranslations('form');
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">{t('editTitle')}</h1>
      <ListingForm country={listing.country} listing={listing} />
    </div>
  );
}
