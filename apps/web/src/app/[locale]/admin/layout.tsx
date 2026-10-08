import {
  Gauge,
  LayoutDashboard,
  LogOut,
  Package,
  Receipt,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Star,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { CommandPalette } from '@/components/admin/command-palette';
import { Hotkeys } from '@/components/admin/hotkeys';
import { AdminNavLink } from '@/components/admin/nav-link';
import { SearchButton } from '@/components/admin/search-button';
import { Toaster } from '@/components/admin/toaster';
import { Avatar, Pill } from '@/components/admin/ui';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { listingStats, settle } from '@/lib/admin/api';
import { authTime, STEP_UP_SECONDS } from '@/lib/admin/session';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { canOpen, isStaff, NAV_GROUPS, type Section, STAFF_ROLES } from '@/lib/staff';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    robots: { index: false },
  };
}

const ICONS: Record<Section, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  moderation: ShieldCheck,
  users: Users,
  listings: Package,
  orders: Receipt,
  reviews: Star,
  operations: Gauge,
  tools: Wrench,
  staff: UserCog,
  audit: ScrollText,
};

/** "development", "staging" or "production", from the public URL (shown so nobody mixes them up). */
function environment(): 'development' | 'production' {
  const host = new URL(env.publicBaseUrl).hostname;
  return host.endsWith('.localhost') || host === 'localhost' || host.startsWith('dev.')
    ? 'development'
    : 'production';
}

/**
 * The admin console's frame (admin.<domain>, ADR-0028/0030): its own session (admin-bff), staff
 * only. Sidebar sections by role, ⌘K palette, keyboard shortcuts, toasts, and a sign-in freshness
 * indicator for step-up actions.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(`/${locale}/admin`)}&locale=${locale}`);
  }
  const t = await getTranslations('admin');
  const roles = session.user.roles;
  const logoutAction = `/auth/logout?returnTo=${encodeURIComponent(`/${locale}/admin`)}`;

  if (!isStaff(roles)) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8"
      >
        <h1 className="text-2xl font-bold">{t('noAccess.title')}</h1>
        <p className="text-muted-foreground">{t('noAccess.body', { email: session.user.email })}</p>
        <form action={logoutAction} method="post">
          <button
            type="submit"
            className="font-semibold text-primary hover:underline"
            data-testid="admin-logout"
          >
            {t('logout')}
          </button>
        </form>
      </main>
    );
  }

  const [stats, signedInAt, jar] = await Promise.all([
    canOpen('moderation', roles) ? settle(listingStats()) : null,
    authTime(),
    cookies(),
  ]);
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => canOpen(i.section, roles)),
  })).filter((g) => g.items.length);
  const flat = groups.flatMap((g) =>
    g.items.map((i) => ({
      ...i,
      label: t(`sections.${i.section}`),
      group: t(`groups.${g.group}`),
    })),
  );
  const fresh = signedInAt ? STEP_UP_SECONDS - (Date.now() - signedInAt) / 1000 : -1;
  const env_ = environment();
  const staffRoles = roles.filter((r) => (STAFF_ROLES as readonly string[]).includes(r));
  const name = session.user.name ?? session.user.email ?? '';

  return (
    <div className="flex min-h-screen flex-col md:flex-row" data-testid="admin-console">
      <aside className="flex shrink-0 flex-col gap-4 border-b bg-card/60 p-3 md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-e">
        <div className="flex items-center justify-between gap-2 px-2 pt-1">
          <div>
            <p className="font-display text-xl font-extrabold tracking-[-0.04em]">
              raadiso<span className="text-primary">.</span>
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('title')}
            </p>
          </div>
          <Pill tone={env_ === 'production' ? 'bad' : 'warn'} dot testId="admin-environment">
            {t(`environment.${env_}`)}
          </Pill>
        </div>
        <SearchButton label={t('palette.button')} />
        <nav
          aria-label={t('nav')}
          className="flex gap-1 overflow-x-auto md:flex-1 md:flex-col md:gap-4 md:overflow-y-auto"
        >
          {groups.map((g) => (
            <div key={g.group} className="flex gap-1 md:flex-col">
              <p className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:block">
                {t(`groups.${g.group}`)}
              </p>
              {g.items.map(({ section, href, key }) => {
                const Icon = ICONS[section];
                return (
                  <AdminNavLink
                    key={section}
                    href={href}
                    testId={`admin-nav-${section}`}
                    hotkey={key}
                    count={section === 'moderation' ? stats?.moderation.listings : undefined}
                  >
                    <Icon aria-hidden className="size-4" />
                    {t(`sections.${section}`)}
                  </AdminNavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="hidden space-y-3 border-t px-2 pt-3 text-xs md:block">
          <div className="flex items-center gap-2.5">
            <Avatar name={name} id={session.user.id} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold" data-testid="admin-user">
                {session.user.email}
              </p>
              <p className="truncate text-muted-foreground">
                {staffRoles.map((r) => t(`roles.${r}` as never)).join(' · ')}
              </p>
            </div>
          </div>
          <p
            className={`flex items-center gap-1.5 ${fresh > 0 ? 'text-success' : 'text-muted-foreground'}`}
            data-testid="admin-step-up"
            title={t('stepUp.explain')}
          >
            {fresh > 0 ? (
              <ShieldCheck aria-hidden className="size-3.5" />
            ) : (
              <ShieldAlert aria-hidden className="size-3.5" />
            )}
            {fresh > 0
              ? t('stepUp.fresh', { minutes: Math.max(1, Math.round(fresh / 60)) })
              : t('stepUp.stale')}
          </p>
          <ThemeSwitcher initial={theme} testId="admin-theme" compact />
          <form id="admin-logout-form" action={logoutAction} method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
              data-testid="admin-logout"
            >
              <LogOut aria-hidden className="size-3.5" />
              {t('logout')}
            </button>
          </form>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
      <CommandPalette
        nav={flat.map((f) => ({
          href: f.href,
          label: f.label,
          group: f.group,
          keys: `g ${f.key}`,
        }))}
        canSearch={canOpen('users', roles) || canOpen('listings', roles)}
      />
      <Hotkeys sections={flat.map((f) => ({ key: f.key, href: f.href, label: f.label }))} />
      <Toaster />
    </div>
  );
}
