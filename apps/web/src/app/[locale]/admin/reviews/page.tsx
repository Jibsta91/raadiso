import { Input, Select } from '@raadi/ui';
import { Star } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { removeReviewAction } from '@/app/[locale]/admin/actions';
import { ActionDialog } from '@/components/admin/action-dialog';
import { Ago } from '@/components/admin/time';
import {
  Empty,
  Field,
  FilterBar,
  Id,
  inputCls,
  PageHeader,
  Pager,
  Pill,
  Unavailable,
} from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import { type ReviewQuery, searchReviews, settle } from '@/lib/admin/api';
import { REVIEW_REMOVAL_REASONS } from '@/lib/admin/reasons';
import { getSession } from '@/lib/session';
import { can, canOpen } from '@/lib/staff';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('reviews') };
}

const PAGE = 20;

/** Reviews, including removed ones; moderators remove abusive or fake reviews with a reason. */
export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('reviews', session.user.roles)) notFound();
  const roles = session.user.roles;
  const t = await getTranslations('admin.reviews');
  const rating = Number(sp.rating);
  const query: ReviewQuery = {
    user: /^[0-9a-f-]{36}$/i.test(sp.user ?? '') ? sp.user : undefined,
    rating: rating >= 1 && rating <= 5 ? rating : undefined,
    removed: sp.removed === 'true' ? 'true' : sp.removed === 'false' ? 'false' : undefined,
    limit: PAGE,
    offset: Math.max(0, Number(sp.offset) || 0),
  };
  const page = await settle(searchReviews(query));
  const href = (offset: number) =>
    `/admin/reviews?${new URLSearchParams(
      Object.entries({ ...query, offset: String(offset), limit: undefined })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    )}`;
  const userLink = (id: string, name?: string) =>
    canOpen('users', roles) ? (
      <Link href={`/admin/users/${id}`} prefetch={false} className="font-medium hover:underline">
        {name ?? id.slice(0, 8)}
      </Link>
    ) : name ? (
      <span className="font-medium">{name}</span>
    ) : (
      <Id value={id} />
    );

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} />
      <FilterBar testId="review-filters">
        <Field label={t('filters.rating')}>
          <Select name="rating" defaultValue={query.rating ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {'★'.repeat(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.state')}>
          <Select name="removed" defaultValue={query.removed ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            <option value="false">{t('filters.visible')}</option>
            <option value="true">{t('filters.removed')}</option>
          </Select>
        </Field>
        <Field label={t('filters.user')}>
          <Input
            name="user"
            defaultValue={query.user}
            placeholder="uuid"
            className={`${inputCls} w-80 font-mono`}
          />
        </Field>
        <button
          type="submit"
          className="h-9 rounded-full bg-ink px-4 text-sm font-semibold text-ink-foreground"
        >
          {t('filters.apply')}
        </button>
      </FilterBar>
      {!page ? (
        <Unavailable>{t('unavailable')}</Unavailable>
      ) : page.items.length === 0 ? (
        <Empty icon={Star} testId="reviews-empty">
          {t('empty')}
        </Empty>
      ) : (
        <>
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="reviews-list">
            {page.items.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-3 rounded-card border bg-card p-4"
                data-testid="review-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <p
                      className="text-lg leading-none tracking-wider text-rating"
                      aria-label={t('stars', { count: r.rating })}
                    >
                      {'★'.repeat(r.rating)}
                      <span className="text-muted">{'★'.repeat(5 - r.rating)}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {userLink(r.reviewerId, r.reviewerName)} → {userLink(r.subjectId)} ·{' '}
                      {t(`roles.${r.subjectRole}`)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    <Ago at={r.createdAt} />
                  </span>
                </div>
                {r.comment ? (
                  <p className="whitespace-pre-wrap text-sm">{r.comment}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">{t('noComment')}</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-xs">
                  <Link
                    href={`/admin/listings/${r.listingId}`}
                    prefetch={false}
                    className="truncate text-muted-foreground hover:underline"
                  >
                    {r.listingTitle}
                  </Link>
                  {r.removedAt ? (
                    <Pill tone="bad">{t(`removedBy.${r.removedBy ?? 'moderator'}`)}</Pill>
                  ) : can('moderate', roles) ? (
                    <ActionDialog
                      action={removeReviewAction}
                      label={t('remove')}
                      icon="trash"
                      tone="ghost"
                      size="sm"
                      title={t('removeTitle')}
                      description={t('removeDescription')}
                      hidden={{ id: r.id }}
                      reasons={{
                        label: t('reason'),
                        options: REVIEW_REMOVAL_REASONS.map((x) => ({
                          value: x,
                          label: t(`reasons.${x}`),
                        })),
                      }}
                      note={{ label: t('note') }}
                      testId="review-remove"
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <Pager
            total={page.total}
            offset={query.offset ?? 0}
            limit={PAGE}
            href={href}
            labels={{
              prev: t('prev'),
              next: t('next'),
              range: t('range', {
                from: (query.offset ?? 0) + 1,
                to: (query.offset ?? 0) + page.items.length,
                total: page.total,
              }),
            }}
          />
        </>
      )}
    </div>
  );
}
