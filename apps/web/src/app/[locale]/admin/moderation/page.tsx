import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ModerationActions } from '@/components/moderation/moderation-actions';
import { reportQueue, ServiceUnavailableError } from '@/lib/api';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('moderation');
  return { title: t('title'), robots: { index: false } };
}

/** Moderators' queue of reported listings (ADR-0027), most reported first. */
export default async function ModerationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The admin layout already requires a staff session; this section is for moderators.
  const session = await getSession();
  if (!session.authenticated || !canOpen('moderation', session.user.roles)) notFound();
  const [t, tr, format] = await Promise.all([
    getTranslations('moderation'),
    getTranslations('report'),
    getFormatter(),
  ]);
  let items;
  try {
    items = await reportQueue();
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
        {t('unavailable')}
      </div>
    );
  }
  if (!items) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      {items.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 py-16 text-center"
          data-testid="moderation-empty"
        >
          <ShieldCheck aria-hidden className="size-10 text-muted-foreground" />
          <p className="text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <ul className="space-y-3" role="list" data-testid="moderation-queue">
          {items.map((item) => (
            <li
              key={item.listing.id}
              className="flex flex-col gap-4 rounded-3xl border bg-card p-4 sm:flex-row"
              data-testid="moderation-item"
            >
              {item.listing.image ? (
                <img
                  src={item.listing.image.thumb}
                  alt=""
                  className="h-24 w-32 shrink-0 rounded-2xl object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {/* The listing on the website (the admin host serves only the console). */}
                  <a
                    href={`${env.publicBaseUrl}/${locale}/listings/${item.listing.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold hover:underline"
                  >
                    {item.listing.title}
                  </a>
                  <span className="text-sm text-muted-foreground">
                    {item.listing.sellerName}
                    {item.listing.status !== 'active'
                      ? ` · ${t(`status.${item.listing.status}`)}`
                      : ''}
                  </span>
                </div>
                <p className="flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
                    {t('count', { count: item.count })}
                  </span>
                  {Object.entries(item.reasons).map(([reason, n]) => (
                    <span
                      key={reason}
                      className="rounded-full bg-soft px-2 py-0.5 text-soft-foreground"
                    >
                      {tr(`reasons.${reason}` as never)} · {n}
                    </span>
                  ))}
                  <span className="text-muted-foreground">
                    {t('since', {
                      date: format.dateTime(new Date(item.firstReportedAt), {
                        dateStyle: 'medium',
                      }),
                    })}
                  </span>
                </p>
                {item.comments.length ? (
                  <ul className="space-y-1 text-sm">
                    {item.comments.map((c) => (
                      <li key={c.createdAt} className="border-l-2 pl-3 text-subtle-foreground">
                        {c.comment}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <ModerationActions
                listingId={item.listing.id}
                removed={item.listing.status === 'deleted'}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
