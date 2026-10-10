import { Badge } from '@raadi/ui';
import { Image as ImageIcon, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { inbox } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messages');
  return { title: t('title'), robots: { index: false } };
}

export default async function InboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(`/${locale}/messages`)}&locale=${locale}`);
  }
  const [t, format, page] = await Promise.all([
    getTranslations('messages'),
    getFormatter(),
    inbox(),
  ]);
  const items = page?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <MessageCircle aria-hidden className="size-10" />
          <p>{t('empty')}</p>
        </div>
      ) : (
        <ul
          className="divide-y overflow-hidden rounded-card border bg-card"
          role="list"
          data-testid="conversation-list"
        >
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/messages/${c.id}`}
                className="flex items-center gap-4 p-3 hover:bg-accent"
                data-testid="conversation-item"
              >
                {c.listing.image ? (
                  <img
                    src={c.listing.image.thumb}
                    alt=""
                    className="h-14 w-16 rounded-card object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-16 items-center justify-center rounded-card bg-placeholder">
                    <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className={`truncate ${c.unread ? 'font-bold' : 'font-medium'}`}>
                      {c.counterpart.name}
                    </span>
                    <time
                      dateTime={c.lastMessageAt}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {format.relativeTime(new Date(c.lastMessageAt))}
                    </time>
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{c.listing.title}</p>
                  {c.lastMessage ? (
                    <p className="truncate text-sm">
                      {c.lastMessage.fromMe ? `${t('you')}: ` : ''}
                      {c.lastMessage.body}
                    </p>
                  ) : null}
                </div>
                {c.unread ? (
                  <Badge
                    data-testid="conversation-unread"
                    aria-label={t('unread', { count: c.unread })}
                  >
                    {c.unread}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
