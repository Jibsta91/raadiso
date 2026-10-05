import { UserX, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ago } from '@/components/admin/time';
import {
  Avatar,
  Empty,
  Field,
  FilterBar,
  inputCls,
  PageHeader,
  Pager,
  Pill,
  Stat,
  Table,
  td,
  Unavailable,
} from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import { searchUsers, settle, userStats, type UserQuery } from '@/lib/admin/api';
import { count } from '@/lib/admin/format';
import { getSession } from '@/lib/session';
import { canOpen, STAFF_ROLES, type StaffRole } from '@/lib/staff';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('users') };
}

const PAGE = 25;

/** Find accounts (support, platform admins): by e-mail, name or id; by staff role or status. */
export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('users', session.user.roles)) notFound();
  const t = await getTranslations('admin.users');
  const tr = await getTranslations('admin.roles');

  const query: UserQuery = {
    q: sp.q?.trim() || undefined,
    role: STAFF_ROLES.includes(sp.role as StaffRole) ? (sp.role as StaffRole) : undefined,
    status: sp.status === 'suspended' || sp.status === 'active' ? sp.status : undefined,
    first: Math.max(0, Number(sp.first) || 0),
    max: PAGE,
  };
  const [page, stats] = await Promise.all([settle(searchUsers(query)), settle(userStats())]);
  const href = (first: number) =>
    `/admin/users?${new URLSearchParams(
      Object.entries({ ...query, first: String(first), max: undefined })
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    )}`;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} />
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label={t('stats.total')}
            value={count(stats.total, locale)}
            trend={stats.signups.map((d) => d.count)}
            hint={t('stats.signups', { count: stats.signups.reduce((n, d) => n + d.count, 0) })}
            tone="good"
          />
          <Stat
            label={t('stats.active')}
            value={count(stats.active.at(-1)?.count ?? 0, locale)}
            trend={stats.active.map((d) => d.count)}
            hint={t('stats.activeHint')}
          />
          <Stat
            label={t('stats.suspended')}
            value={count(stats.suspended, locale)}
            hint={t('stats.staff', { count: stats.staff })}
            href="/admin/users?status=suspended"
            tone="bad"
          />
        </div>
      ) : null}

      <FilterBar testId="user-filters">
        <Field label={t('filters.q')}>
          <input
            name="q"
            defaultValue={query.q}
            placeholder={t('filters.qPlaceholder')}
            className={`${inputCls} w-72`}
            data-testid="user-search"
            autoFocus
          />
        </Field>
        <Field label={t('filters.role')}>
          <select name="role" defaultValue={query.role ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filters.status')}>
          <select name="status" defaultValue={query.status ?? ''} className={inputCls}>
            <option value="">{t('filters.any')}</option>
            <option value="active">{t('status.active')}</option>
            <option value="suspended">{t('status.suspended')}</option>
          </select>
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
        <Empty icon={query.status === 'suspended' ? UserX : Users} testId="users-empty">
          {t('empty')}
        </Empty>
      ) : (
        <>
          <Table
            testId="users-table"
            head={[
              t('columns.user'),
              t('columns.status'),
              t('columns.roles'),
              t('columns.created'),
              t('columns.lastLogin'),
            ]}
          >
            {page.items.map((u) => (
              <tr key={u.id} className="hover:bg-accent/50" data-testid="user-row">
                <td className={td}>
                  <Link
                    href={`/admin/users/${u.id}`}
                    prefetch={false}
                    className="flex items-center gap-3"
                  >
                    <Avatar name={u.name ?? u.email ?? '?'} id={u.id} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium hover:underline">
                        {u.name ?? u.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.email}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className={td}>
                  {u.suspended ? (
                    <Pill tone="bad" dot>
                      {t('status.suspended')}
                    </Pill>
                  ) : !u.emailVerified ? (
                    <Pill tone="warn" dot>
                      {t('status.unverified')}
                    </Pill>
                  ) : (
                    <Pill tone="good" dot>
                      {t('status.active')}
                    </Pill>
                  )}
                </td>
                <td className={td}>
                  <span className="flex flex-wrap gap-1">
                    {u.staffRoles.map((r) => (
                      <Pill key={r} tone="info">
                        {tr(r)}
                      </Pill>
                    ))}
                  </span>
                </td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                  {u.createdAt ? <Ago at={u.createdAt} /> : '–'}
                </td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                  {u.lastLoginAt ? <Ago at={u.lastLoginAt} /> : t('never')}
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            total={page.total}
            offset={query.first ?? 0}
            limit={PAGE}
            href={href}
            labels={{
              prev: t('prev'),
              next: t('next'),
              range: t('range', {
                from: (query.first ?? 0) + 1,
                to: (query.first ?? 0) + page.items.length,
                total: page.total,
              }),
            }}
          />
        </>
      )}
    </div>
  );
}
