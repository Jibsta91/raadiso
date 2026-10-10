import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Thread } from '@/components/messaging/thread';
import { ReviewForm } from '@/components/trust/review-form';
import { Link } from '@/i18n/navigation';
import { conversation, reviewEligibility } from '@/lib/api';
import { getSession } from '@/lib/session';
import { ClientMessages } from '@/components/client-messages';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messages');
  return { title: t('title'), robots: { index: false } };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/messages/${id}`)}&locale=${locale}`,
    );
  }
  if (!UUID.test(id)) notFound();
  const [t, tt, detail] = await Promise.all([
    getTranslations('messages'),
    getTranslations('trust'),
    conversation(id),
  ]);
  if (!detail) notFound();
  const eligibility = await reviewEligibility(detail.listing.id, detail.counterpart.id);

  return (
    <ClientMessages set="thread">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/messages" className="text-sm text-primary hover:underline">
          ← {t('title')}
        </Link>
        <header className="flex items-center gap-4 rounded-card border bg-card p-3">
          {detail.listing.image ? (
            <img
              src={detail.listing.image.thumb}
              alt=""
              className="h-16 w-20 rounded-card object-cover"
            />
          ) : null}
          <div>
            <h1 className="text-xl font-bold" data-testid="thread-counterpart">
              {detail.counterpart.name}
            </h1>
            <Link
              href={`/listings/${detail.listing.id}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              {detail.listing.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {t(detail.role === 'buyer' ? 'roleBuyer' : 'roleSeller')}
            </p>
          </div>
        </header>
        {eligibility?.canReview ? (
          <ReviewForm
            listingId={detail.listing.id}
            subjectId={detail.counterpart.id}
            subjectName={detail.counterpart.name}
            subjectRole={eligibility.subjectRole}
          />
        ) : null}
        {eligibility && !eligibility.canReview && eligibility.reason === 'already_reviewed' ? (
          <p className="rounded-card border bg-card p-4 text-sm" data-testid="review-done">
            {tt('reviewed', { name: detail.counterpart.name })}{' '}
            <Link href={`/users/${detail.counterpart.id}`} className="text-primary hover:underline">
              {tt('seeProfile')}
            </Link>
          </p>
        ) : null}
        <Thread initial={detail} />
      </div>
    </ClientMessages>
  );
}
