import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { RemoveReview } from '@/components/trust/remove-review';
import { Stars } from '@/components/trust/stars';
import { VerifiedBadge } from '@/components/trust/verified-badge';
import { Link } from '@/i18n/navigation';
import { trustProfile } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODERATORS = ['moderator', 'platform-admin'];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations('trust');
  const profile = UUID.test(id) ? await trustProfile(id).catch(() => null) : null;
  return { title: profile ? t('profileTitle', { name: profile.name }) : t('profile') };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID.test(id)) notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [t, format, session, profile] = await Promise.all([
    getTranslations('trust'),
    getFormatter(),
    getSession(),
    trustProfile(id, (page - 1) * 20),
  ]);
  if (!profile) notFound();
  const { rating, verification, reviews } = profile;
  const viewer = session.authenticated ? session.user : null;
  const isModerator = viewer?.roles.some((r) => MODERATORS.includes(r)) ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold" data-testid="profile-name">
          {profile.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {verification ? (
            <VerifiedBadge
              label={t('verifiedSince', {
                date: format.dateTime(new Date(verification.verifiedAt), { dateStyle: 'medium' }),
              })}
            />
          ) : (
            <span className="text-sm text-muted-foreground">{t('notVerified')}</span>
          )}
        </div>
      </header>

      <section aria-labelledby="rating" className="space-y-3 rounded-lg border p-4">
        <h2 id="rating" className="font-semibold">
          {t('rating')}
        </h2>
        {rating.count > 0 && rating.average !== null ? (
          <div className="grid gap-4 sm:grid-cols-[max-content_1fr] sm:items-center">
            <div className="text-center">
              <p className="text-4xl font-bold" data-testid="profile-average">
                {format.number(rating.average, { minimumFractionDigits: 1 })}
              </p>
              <Stars
                value={rating.average}
                label={t('outOf5', { value: format.number(rating.average) })}
              />
              <p className="text-sm text-muted-foreground" data-testid="profile-count">
                {t('reviewCount', { count: rating.count })}
              </p>
            </div>
            <ol className="space-y-1 text-sm">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = rating.distribution[n - 1] ?? 0;
                return (
                  <li key={n} className="flex items-center gap-2">
                    <span className="w-14 text-muted-foreground">{t('stars', { count: n })}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
                      <span
                        className="block h-full bg-amber-400"
                        style={{ width: `${(count / rating.count) * 100}%` }}
                      />
                    </span>
                    <span className="w-8 text-right tabular-nums">{count}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <p className="text-muted-foreground">{t('noReviewsYet')}</p>
        )}
      </section>

      {reviews.items.length > 0 ? (
        <section aria-labelledby="reviews" className="space-y-3">
          <h2 id="reviews" className="text-lg font-semibold">
            {t('reviews')}
          </h2>
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {reviews.items.map((r) => (
              <li key={r.id} className="space-y-2 p-4" data-testid="review-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Stars value={r.rating} label={t('outOf5', { value: r.rating })} />
                  <span className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}
                  </span>
                </div>
                {r.comment ? <p className="whitespace-pre-line">{r.comment}</p> : null}
                <p className="text-sm text-muted-foreground">
                  {t.rich(r.subjectRole === 'seller' ? 'byBuyer' : 'bySeller', {
                    name: r.reviewer.name,
                    listing: r.listing.title,
                    reviewer: (chunks) => (
                      <Link href={`/users/${r.reviewer.id}`} className="hover:underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
                {viewer && (isModerator || viewer.id === r.reviewer.id) ? (
                  <RemoveReview id={r.id} asModerator={viewer.id !== r.reviewer.id} />
                ) : null}
              </li>
            ))}
          </ul>
          {reviews.total > page * 20 ? (
            <Link
              href={`/users/${id}?page=${page + 1}`}
              className="text-sm text-primary hover:underline"
            >
              {t('more')}
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
