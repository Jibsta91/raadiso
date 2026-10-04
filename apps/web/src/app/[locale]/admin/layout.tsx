import { LayoutDashboard, LogOut, ScrollText, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminNavLink } from '@/components/admin/nav-link';
import { getSession } from '@/lib/session';
import { canOpen, isStaff, type Section } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    robots: { index: false },
  };
}

const NAV: Array<{ section: Section; href: string; Icon: typeof LayoutDashboard }> = [
  { section: 'overview', href: '/admin', Icon: LayoutDashboard },
  { section: 'moderation', href: '/admin/moderation', Icon: ShieldCheck },
  { section: 'audit', href: '/admin/audit', Icon: ScrollText },
];

/**
 * The admin console's frame (admin.<domain>, ADR-0028): its own session (admin-bff), staff
 * only. The sidebar shows the sections the person's roles open.
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

  if (!isStaff(roles)) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8"
      >
        <h1 className="text-2xl font-bold">{t('noAccess.title')}</h1>
        <p className="text-muted-foreground">{t('noAccess.body', { email: session.user.email })}</p>
        <form
          action={`/auth/logout?returnTo=${encodeURIComponent(`/${locale}/admin`)}`}
          method="post"
        >
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

  return (
    <div className="flex min-h-screen flex-col md:flex-row" data-testid="admin-console">
      <aside className="flex shrink-0 flex-col gap-6 border-b bg-card p-4 md:w-60 md:border-b-0 md:border-r">
        <div className="space-y-1 px-2">
          <p className="font-display text-xl font-extrabold tracking-[-0.04em]">
            raadiso<span className="text-primary">.</span>
          </p>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('title')}
          </p>
        </div>
        <nav aria-label={t('nav')} className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.filter((n) => canOpen(n.section, roles)).map(({ section, href, Icon }) => (
            <AdminNavLink key={section} href={href} testId={`admin-nav-${section}`}>
              <Icon aria-hidden className="size-4" />
              {t(`sections.${section}`)}
            </AdminNavLink>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-2 border-t px-2 pt-4 text-xs md:block">
          <p className="truncate font-medium" data-testid="admin-user">
            {session.user.email}
          </p>
          <p className="text-muted-foreground">
            {roles
              .filter((r) => ['moderator', 'support', 'operator', 'platform-admin'].includes(r))
              .map((r) => t(`roles.${r}` as never))
              .join(' · ')}
          </p>
          <form
            action={`/auth/logout?returnTo=${encodeURIComponent(`/${locale}/admin`)}`}
            method="post"
          >
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
      <main id="main" className="min-w-0 flex-1 p-4 sm:p-8">
        {children}
      </main>
    </div>
  );
}
