import { Check, UserPlus } from 'lucide-react';
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
  Panel,
  Pill,
  Table,
  td,
  Unavailable,
} from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import { auditStats, searchUsers, settle, staffMembers } from '@/lib/admin/api';
import { getSession } from '@/lib/session';
import { canOpen, STAFF_ROLES } from '@/lib/staff';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('staff') };
}

/**
 * Staff and their roles (platform admins): who can do what, how active they were, and how to add
 * someone. Roles change on the person's page (step-up, reason, audited; they are signed out).
 */
export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('staff', session.user.roles)) notFound();
  const [t, tr] = await Promise.all([
    getTranslations('admin.staff'),
    getTranslations('admin.roles'),
  ]);
  const q = sp.q?.trim();
  const [staff, stats, found] = await Promise.all([
    settle(staffMembers()),
    settle(auditStats(14)),
    q ? settle(searchUsers({ q, max: 5 })) : null,
  ]);
  const actions = new Map((stats?.actors ?? []).map((a) => [a.id, a.count]));

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} />
      {!staff ? (
        <Unavailable>{t('unavailable')}</Unavailable>
      ) : (
        <Table
          testId="staff-table"
          head={[
            t('columns.person'),
            ...STAFF_ROLES.map((r) => tr(r)),
            t('columns.actions'),
            t('columns.lastLogin'),
          ]}
        >
          {staff.items.map((s) => (
            <tr key={s.id} className="hover:bg-accent/50" data-testid="staff-row">
              <td className={td}>
                <Link
                  href={`/admin/users/${s.id}`}
                  prefetch={false}
                  className="flex items-center gap-3"
                >
                  <Avatar name={s.name ?? s.email ?? '?'} id={s.id} size="sm" />
                  <span>
                    <span className="block font-medium hover:underline">{s.name ?? s.email}</span>
                    <span className="block text-xs text-muted-foreground">{s.email}</span>
                  </span>
                </Link>
              </td>
              {STAFF_ROLES.map((r) => (
                <td key={r} className={`${td} text-center`}>
                  {s.staffRoles.includes(r) ? (
                    <Check aria-label={tr(r)} className="mx-auto size-4 text-success" />
                  ) : (
                    <span aria-hidden className="text-muted">
                      ·
                    </span>
                  )}
                </td>
              ))}
              <td className={`${td} tabular-nums`}>{actions.get(s.id) ?? 0}</td>
              <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                {s.lastLoginAt ? <Ago at={s.lastLoginAt} /> : t('never')}
                {s.suspended ? (
                  <Pill tone="bad" className="ms-2">
                    {t('suspended')}
                  </Pill>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('add')} icon={UserPlus}>
          <FilterBar testId="staff-add">
            <Field label={t('find')}>
              <input
                name="q"
                defaultValue={q}
                placeholder={t('findPlaceholder')}
                className={`${inputCls} w-72`}
              />
            </Field>
            <button
              type="submit"
              className="h-9 rounded-full bg-ink px-4 text-sm font-semibold text-ink-foreground"
            >
              {t('search')}
            </button>
          </FilterBar>
          {found ? (
            found.items.length ? (
              <ul className="mt-4 space-y-2">
                {found.items.map((u) => (
                  <li key={u.id}>
                    <Link
                      href={`/admin/users/${u.id}`}
                      prefetch={false}
                      className="flex items-center gap-3 rounded-xl border p-2 text-sm hover:bg-accent"
                    >
                      <Avatar name={u.name ?? u.email ?? '?'} id={u.id} size="sm" />
                      <span className="flex-1">{u.email}</span>
                      <span className="text-xs font-semibold text-primary">{t('openToGrant')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t('noMatch')}</Empty>
            )
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">{t('addHint')}</p>
          )}
        </Panel>
        <Panel title={t('matrix')}>
          <ul className="space-y-3 text-sm">
            {STAFF_ROLES.map((r) => (
              <li key={r}>
                <p className="font-semibold">{tr(r)}</p>
                <p className="text-muted-foreground">{t(`explain.${r}`)}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
