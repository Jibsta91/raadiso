import { noticePrices } from '@raadi/catalog/money';
import { Bell } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import {
  EmailPreferences,
  MarkAllRead,
  NotificationLink,
} from '@/components/notifications/notification-controls';
import { notifications } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications');
  return { title: t('title'), robots: { index: false } };
}

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/notifications`)}&locale=${locale}`,
    );
  }
  const [t, format, data] = await Promise.all([
    getTranslations('notifications'),
    getFormatter(),
    notifications(),
  ]);
  const items = data?.list.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        {data?.list.unread ? <MarkAllRead /> : null}
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Bell aria-hidden className="size-10" />
          <p>{t('empty')}</p>
        </div>
      ) : (
        <ul
          className="divide-y overflow-hidden rounded-3xl border bg-card"
          role="list"
          data-testid="notification-list"
        >
          {items.map((n) => (
            <li key={n.id} data-read={n.read}>
              <NotificationLink id={n.id} link={n.link} href={`/${locale}${n.link}`}>
                <p className={n.read ? '' : 'flex items-start gap-2 font-semibold'}>
                  {n.read ? null : (
                    <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                  {t(
                    `kinds.${n.kind}` as never,
                    {
                      ...n.params,
                      ...noticePrices(n.params, locale),
                    } as never,
                  )}
                </p>
                <time
                  dateTime={n.createdAt}
                  className={`text-xs text-muted-foreground ${n.read ? '' : 'ps-4'}`}
                >
                  {format.relativeTime(new Date(n.createdAt))}
                </time>
              </NotificationLink>
            </li>
          ))}
        </ul>
      )}
      {data ? <EmailPreferences initial={data.preferences} /> : null}
    </div>
  );
}
