import type { MyReview, PendingReview } from '@raadi/api-client';
import { cn } from '@raadi/ui';
import { Star } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ReviewForm } from '@/components/trust/review-form';
import { Link } from '@/i18n/navigation';
import { myReviews, pendingReviews, ServiceUnavailableError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myReviews');
  return { title: t('title'), robots: { index: false } };
}

type Tab = 'received' | 'given';
type T = Awaited<ReturnType<typeof getTranslations<'myReviews'>>>;

function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn('size-4', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted')}
        />
      ))}
    </span>
  );
}

const nameOf = (t: T, other: { name: string | null; role: 'buyer' | 'seller' }) =>
  other.name ?? (other.role === 'seller' ? t('theSeller') : t('theBuyer'));

function Pending({ pending, t }: { pending: PendingReview; t: T }) {
  const seller = pending.other.role === 'seller';
  const name = nameOf(t, pending.other);
  const days = Math.max(0, Math.ceil((Date.parse(pending.deadline) - Date.now()) / DAY));
  return (
    <li className="space-y-3 rounded-xl border bg-card p-4" data-testid="pending-review">
      <p className="text-lg font-semibold">{t(seller ? 'askSeller' : 'askBuyer', { name })}</p>
      <p>
        <Link
          href={`/listings/${pending.listing.id}`}
          prefetch={false}
          className="font-medium hover:underline"
        >
          {pending.listing.title}
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">
        {days <= 1 ? t('lastDay') : t('daysLeft', { count: days })}
      </p>
      <details>
        <summary
          className="inline-flex h-10 cursor-pointer list-none items-center rounded-full bg-primary px-5 font-semibold text-primary-foreground"
          data-testid="pending-review-give"
        >
          {t('give')}
        </summary>
        <div className="mt-3">
          <ReviewForm
            listingId={pending.listing.id}
            subjectId={pending.other.id}
            subjectName={name}
            subjectRole={pending.other.role}
          />
        </div>
      </details>
    </li>
  );
}

function Review({ review, tab, t, date }: { review: MyReview; tab: Tab; t: T; date: string }) {
  const seller = review.other.role === 'seller';
  const name = nameOf(t, review.other);
  const who =
    tab === 'given'
      ? t(seller ? 'boughtFrom' : 'soldTo', { name })
      : t(seller ? 'fromSeller' : 'fromBuyer', { name });
  return (
    <li className="space-y-1.5 rounded-xl border bg-card p-4" data-testid="my-review">
      <Link
        href={`/users/${review.other.id}`}
        prefetch={false}
        className="text-sm font-medium text-primary hover:underline"
      >
        {who}
      </Link>
      <p className="font-semibold">{review.listing.title}</p>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Stars rating={review.rating} label={t('stars', { count: review.rating })} />
        <span>{date}</span>
      </div>
      {review.comment ? <p className="whitespace-pre-line">{review.comment}</p> : null}
    </li>
  );
}

/**
 * The signed-in user's reviews (ADR-0055): finished deals waiting for their review, and the reviews
 * they received and gave. `?tab=given|received`; with deals waiting, "given" opens first.
 */
export default async function MyReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; offset?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/my/reviews`)}&locale=${locale}`,
    );
  }
  const [t, format] = await Promise.all([getTranslations('myReviews'), getFormatter()]);
  let pending: PendingReview[];
  try {
    pending = await pendingReviews();
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
        {t('unavailable')}
      </div>
    );
  }
  const tab: Tab =
    query.tab === 'given' || query.tab === 'received'
      ? query.tab
      : pending.length
        ? 'given'
        : 'received';
  const offset = Math.max(0, Number.parseInt(query.offset ?? '0', 10) || 0);
  const page = (await myReviews(tab, offset).catch(() => null)) ?? { items: [], total: 0 };

  const tabLink = (value: Tab, label: string) => (
    <Link
      href={`/my/reviews?tab=${value}`}
      prefetch={false}
      aria-current={tab === value ? 'page' : undefined}
      data-testid={`reviews-tab-${value}`}
      className={cn(
        'flex-1 rounded-full px-4 py-2 text-center font-semibold',
        tab === value ? 'bg-card shadow-sm' : 'text-muted-foreground',
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="my-reviews">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <nav className="flex gap-1 rounded-full bg-muted p-1" aria-label={t('title')}>
        {tabLink('received', t('received'))}
        {tabLink(
          'given',
          pending.length
            ? `${t('given')} · ${t('waiting', { count: pending.length })}`
            : t('given'),
        )}
      </nav>
      {tab === 'given' && pending.length ? (
        <ul className="space-y-3">
          {pending.map((p) => (
            <Pending key={`${p.listing.id}:${p.other.id}`} pending={p} t={t} />
          ))}
        </ul>
      ) : null}
      {page.items.length ? (
        <ul className="space-y-3">
          {page.items.map((r) => (
            <Review
              key={r.id}
              review={r}
              tab={tab}
              t={t}
              date={format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}
            />
          ))}
        </ul>
      ) : tab === 'given' && pending.length ? null : (
        <p className="text-muted-foreground" data-testid="my-reviews-empty">
          {t(tab === 'given' ? 'emptyGiven' : 'emptyReceived')}
        </p>
      )}
      {offset + page.items.length < page.total ? (
        <Link
          href={`/my/reviews?tab=${tab}&offset=${offset + page.items.length}`}
          prefetch={false}
          className="inline-block font-semibold text-primary hover:underline"
        >
          {t('more')}
        </Link>
      ) : null}
    </div>
  );
}
