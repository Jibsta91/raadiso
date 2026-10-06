import { CATEGORY_KEYS } from '@raadi/catalog';
import { Button } from '@raadi/ui';
import {
  Bell,
  Bookmark,
  Heart,
  LayoutList,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { unreadCount, unreadNotifications } from '@/lib/api';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { isStaff } from '@/lib/staff';
import { AccountMenu } from './account-menu';

const iconButton =
  'relative flex size-11 items-center justify-center rounded-full border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5';
const countBadge =
  'absolute -end-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground';
const menuItem =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:text-muted-foreground';

// The header and footer appear on every page, and their targets are dynamic,
// per-user pages. Prefetching them would cost about ten full server renders per
// page view (each with a session lookup and the unread counts) for results that
// go stale immediately, so these links have prefetch={false}.
export async function Header({ locale }: { locale: string }) {
  const [t, tHome, session] = await Promise.all([
    getTranslations('nav'),
    getTranslations('home'),
    getSession(),
  ]);
  const [unread, alerts] = session.authenticated
    ? await Promise.all([unreadCount(), unreadNotifications()])
    : [0, 0];
  const loginHref = `/auth/login?returnTo=${encodeURIComponent(`/${locale}/account`)}&locale=${locale}`;
  const signupHref = `/auth/login?signup=1&returnTo=${encodeURIComponent(`/${locale}`)}&locale=${locale}`;

  return (
    <header className="sticky top-0 z-40 border-b bg-glass-header backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:px-8 lg:gap-6">
        <Link
          prefetch={false}
          href="/"
          className="rounded-lg font-display text-[28px] font-extrabold leading-none tracking-[-0.04em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Raadiso"
        >
          raadiso<span className="text-primary">.</span>
        </Link>
        <nav aria-label={t('categories')} className="hidden gap-1 lg:flex">
          {CATEGORY_KEYS.map((key) => (
            <Link
              key={key}
              href={`/${key}`}
              prefetch={false}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-subtle-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tHome(`categories.${key}.name`)}
            </Link>
          ))}
        </nav>
        <nav className="ms-auto flex items-center gap-2" aria-label={t('main')}>
          <Link
            href="/search"
            prefetch={false}
            data-testid="nav-search"
            className={iconButton}
            aria-label={t('search')}
          >
            <Search aria-hidden />
          </Link>
          {session.authenticated ? (
            <>
              <Link
                href="/messages"
                prefetch={false}
                data-testid="nav-messages"
                className={iconButton}
                // The link's name carries the count: a label on the badge inside it is never read.
                aria-label={
                  unread > 0 ? `${t('messages')}, ${t('unread', { count: unread })}` : t('messages')
                }
              >
                <MessageCircle aria-hidden />
                {unread > 0 ? (
                  <span aria-hidden className={countBadge} data-testid="nav-unread">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </Link>
              <Link
                prefetch={false}
                href="/notifications"
                data-testid="nav-notifications"
                className={iconButton}
                aria-label={
                  alerts > 0
                    ? `${t('notifications')}, ${t('newAlerts', { count: alerts })}`
                    : t('notifications')
                }
              >
                <Bell aria-hidden />
                {alerts > 0 ? (
                  <span aria-hidden className={countBadge} data-testid="nav-alerts">
                    {alerts > 99 ? '99+' : alerts}
                  </span>
                ) : null}
              </Link>
            </>
          ) : null}
          <Button asChild variant="ink" className="max-sm:size-11 max-sm:px-0">
            <Link
              href="/listings/new"
              prefetch={false}
              data-testid="nav-new-listing"
              aria-label={t('newListing')}
            >
              <Plus aria-hidden className="size-[18px]!" />
              <span className="hidden sm:inline">{t('newListing')}</span>
            </Link>
          </Button>
          {session.authenticated ? (
            <AccountMenu name={session.user.name ?? session.user.email} label={t('accountMenu')}>
              <p className="truncate px-3 pb-2 pt-1 text-xs text-muted-foreground">
                {session.user.email}
              </p>
              <Link href="/account" prefetch={false} className={menuItem}>
                <UserRound aria-hidden />
                {t('account')}
              </Link>
              <Link
                href="/my/listings"
                prefetch={false}
                data-testid="nav-my-listings"
                className={menuItem}
              >
                <LayoutList aria-hidden />
                {t('myListings')}
              </Link>
              <Link
                href="/my/favourites"
                prefetch={false}
                data-testid="nav-favourites"
                className={menuItem}
              >
                <Heart aria-hidden />
                {t('favourites')}
              </Link>
              <Link
                href="/my/saved-searches"
                prefetch={false}
                data-testid="nav-saved-searches"
                className={menuItem}
              >
                <Bookmark aria-hidden />
                {t('savedSearches')}
              </Link>
              {isStaff(session.user.roles) ? (
                // The admin console lives on its own host with its own sign-in (ADR-0028).
                <a
                  href={`${env.adminBaseUrl}/${locale}/admin`}
                  data-testid="nav-admin"
                  className={menuItem}
                >
                  <ShieldCheck aria-hidden />
                  {t('admin')}
                </a>
              ) : null}
              <form action="/auth/logout" method="post" className="mt-1 border-t pt-1">
                <button type="submit" data-testid="nav-logout" className={menuItem}>
                  <LogOut aria-hidden />
                  {t('logout')}
                </button>
              </form>
            </AccountMenu>
          ) : (
            <>
              <Button asChild variant="outline" className="max-sm:hidden">
                <a href={loginHref} data-testid="nav-login">
                  {t('login')}
                </a>
              </Button>
              <Button asChild variant="ghost" className="max-sm:hidden">
                <a href={signupHref} data-testid="nav-signup">
                  {t('signup')}
                </a>
              </Button>
              <a href={loginHref} className={`${iconButton} sm:hidden`} aria-label={t('login')}>
                <UserRound aria-hidden />
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
